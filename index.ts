import * as fs from "fs";
import * as path from "path";
import ts, { CompilerOptions } from "typescript";

import {
  VirtualTypeScriptEnvironment,
  createDefaultMapFromNodeModules,
  createFSBackedSystem,
  createSystem,
  createVirtualTypeScriptEnvironment
} from "@typescript/vfs";

const DOT_TOKEN = ".";

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.cts', '.d.cts', '.mts', '.d.mts'];

export class VirtualDirectory {
  public subdirectories: Map<string, VirtualDirectory>;
  public files: Map<string, VirtualFile>;
  public path: string = '';

  constructor(public name: string, parentPath: string = '') {
    this.subdirectories = new Map();
    this.files = new Map();
    this.path = path.posix.join(parentPath, name);
  }

  public findDirectory(searchPath: string): VirtualDirectory | undefined {
    const normalizedSearchPath = path.posix.normalize(searchPath);
    const parts = normalizedSearchPath.split('/').filter(p => p.length);
    let currentDir: VirtualDirectory | undefined = this;

    for (const part of parts) {
      if (currentDir?.subdirectories.has(part)) {
        currentDir = currentDir.subdirectories.get(part);
      } else {
        return undefined;
      }
    }

    return currentDir;
  }

  public findFiles(fileName: string): VirtualFile[] {
    let foundFiles: VirtualFile[] = [];

    if (this.files.has(fileName)) {
      foundFiles.push(this.files.get(fileName)!);
    }

    this.subdirectories.forEach(subdir => {
      foundFiles = foundFiles.concat(subdir.findFiles(fileName));
    });

    return foundFiles;
  }

  public findFile(searchPath: string): VirtualFile | null {
    const normalizedSearchPath = path.posix.normalize(searchPath);
    const parts = normalizedSearchPath.split('/').filter(p => p.length);
    const fileName = parts.pop();

    const containingDir = this.findDirectory(parts.join('/'));
    if (fileName && containingDir) {
      return containingDir.files.get(fileName) || null;
    }

    return null;
  }

  public addDirectory(path: string): VirtualDirectory {
    const parts = path.split('/').filter(p => p.length);
    let currentDir: VirtualDirectory = this;
    parts.forEach(part => {
      if (!currentDir.subdirectories.has(part)) {
        const newDir = new VirtualDirectory(part, currentDir.path + '/');
        currentDir.subdirectories.set(part, newDir);
        currentDir = newDir;
      } else {
        currentDir = currentDir.subdirectories.get(part)!;
      }
    });

    return currentDir;
  }

  public addFile(path: string, content: string): VirtualFile {
    const parts = path.split('/');
    const fileName = parts.pop();
    const directory = this.addDirectory(parts.join('/'));

    if (fileName) {
      const newFile = new VirtualFile(fileName, content, directory.path + '/');
      directory.files.set(fileName, newFile);
      return newFile;
    } else {
      throw new Error('File name must be provided');
    }
  }

  public removeDirectory(path: string): boolean {
    const parts = path.split('/').filter(p => p.length);
    let currentDir: VirtualDirectory | undefined = this;
    for (const part of parts) {
      currentDir = currentDir.subdirectories.get(part);
      if (!currentDir) return false;
    }

    return currentDir.subdirectories.delete(parts.pop()!);
  }

  public removeFile(searchPath: string): boolean {
    const normalizedSearchPath = path.posix.normalize(searchPath);
    const parts = normalizedSearchPath.split('/').filter(p => p.length);
    const fileName = parts.pop();
    const containingDir = this.findDirectory(parts.join('/'));
    if (fileName && containingDir) {
      return containingDir.files.delete(fileName);
    }

    return false;
  }
}

export class VirtualFile {
  public sourceFile: ts.SourceFile | undefined;
  public path: string = '';
  public extension: string = '';

  constructor(public name: string, public content: string, parentPath: string = '') {
    this.path = path.posix.join(parentPath, name);
    this.extension = this.getExtension(name);
  }

  public updateContent(newContent: string): void {
    this.content = newContent;
  }

  public updateSourceFile(program: ts.Program): void {
    this.sourceFile = program.getSourceFile(this.path);
  }

  private getExtension(fileName: string): string {
    const dotIndex = fileName.lastIndexOf(DOT_TOKEN);
    if (dotIndex === -1) return '';
    return fileName.substring(dotIndex + 1);
  }
}

export class TypeScriptVFS {
  constructor(public root = DOT_TOKEN, public compilerOptions: CompilerOptions = {}) { }

  public _rootDirectory: VirtualDirectory | undefined;
  public get rootDirectory(): VirtualDirectory {
    if (!this._rootDirectory) {
      this._rootDirectory = this.loadPhysicalDirectoryToVirtual(
        this.root,
        new VirtualDirectory(this.root, '/')
      );
    }
    return this._rootDirectory;
  }

  private _environment: VirtualTypeScriptEnvironment | undefined;
  private get environment(): VirtualTypeScriptEnvironment {
    if (!this._environment) {
      this._environment = this.createEnvironment();
    }
    return this._environment;
  }

  private readonly _defaultCompilerOptions: CompilerOptions = {
    baseUrl: this.root,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2016,
    strict: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    lib: ["es2018", "dom"],
  };

  private _fsMap: Map<string, string> | undefined;
  public get fsMap() {
    if (!this._fsMap) {
      this._fsMap = this.createDefaultMap();
    }
    return this._fsMap;
  }

  private _watchProgram: ts.WatchOfFilesAndCompilerOptions<ts.SemanticDiagnosticsBuilderProgram> | undefined;
  private get watchProgram(): ts.WatchOfFilesAndCompilerOptions<ts.SemanticDiagnosticsBuilderProgram> {
    if (!this._watchProgram) {
      this._watchProgram = ts.createWatchProgram(this.host);
    }
    return this._watchProgram;
  }

  private _program!: ts.Program;
  private get program() {
    if (!this._program) {
      this._program = this.watchProgram.getProgram().getProgram();
    }
    return this._program;
  }
  private set program(program: ts.Program) {
    this._program = program;
  }

  private _host: ts.WatchCompilerHostOfFilesAndCompilerOptions<ts.SemanticDiagnosticsBuilderProgram> | undefined;
  private get host(): ts.WatchCompilerHostOfFilesAndCompilerOptions<ts.SemanticDiagnosticsBuilderProgram> {
    if (!this._host) {
      this._host = ts.createWatchCompilerHost(
        [...this.fsMap.keys()],
        this.getCompilerOptions(),
        this.environment.sys
      );
    }
    return this._host;
  }

  public createFile(name: string, content: string): VirtualFile {
    return this.rootDirectory.addFile(name, content);
  }

  public fileExists(name: string): boolean {
    return this.rootDirectory.findFile(name) !== null;
  }

  public readFile(name: string): string | undefined {
    return this.rootDirectory.findFile(name)?.content;
  }

  public updateFile(name: string, content: string): VirtualFile | null {
    const file = this.rootDirectory.findFile(name);
    if (file) {
      file.updateContent(content);
    }

    return file;
  }

  public findFiles(fileName: string): VirtualFile[] {
    return this.rootDirectory?.findFiles(fileName) || [];
  }

  public deleteFile(name: string): boolean {
    return this.rootDirectory.removeFile(name);
  }

  public directoryExists(name: string): boolean {
    return this.rootDirectory.findDirectory(name) !== undefined;
  }

  public getSourceFiles(): readonly ts.SourceFile[] {
    this.flush();
    return this.program
      .getSourceFiles()
      .filter((sf) => sf.fileName.includes(path.posix.resolve(this.root)));
  }

  public flush(): void {
    this._fsMap = this.convertToFsMap(this.rootDirectory);
    this.updateProgramSources([...this.fsMap.keys()]);
    this.updateSourceFiles(this.rootDirectory, this.program);
  }

  private updateSourceFiles(dir: VirtualDirectory, program: ts.Program) {
    dir.files.forEach((file) => {
      file.updateSourceFile(program);
    });

    dir.subdirectories.forEach((subdir) => {
      this.updateSourceFiles(subdir, program);
    });
  }

  private convertToFsMap(dir: VirtualDirectory, fsMap: Map<string, string> = new Map()): Map<string, string> {
    dir.subdirectories.forEach((subdir) => {
      this.convertToFsMap(subdir, fsMap);
    });

    dir.files.forEach((file) => {
      if (SUPPORTED_EXTENSIONS.includes(`.${file.extension}`)) {
        fsMap.set(file.path, file.content);
      }
    });

    return fsMap;
  }

  private loadPhysicalDirectoryToVirtual(physicalDirPath: string, virtualDir: VirtualDirectory) {
    const entries = fs.readdirSync(physicalDirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.posix.join(physicalDirPath, entry.name);
      if (entry.isDirectory()) {
        const newVirtualDir = virtualDir.addDirectory(entry.name);
        this.loadPhysicalDirectoryToVirtual(entryPath, newVirtualDir);
      } else if (entry.isFile()) {
        const fileContent = fs.readFileSync(entryPath, 'utf8');
        virtualDir.addFile(entry.name, fileContent);
      }
    }

    return virtualDir;
  }

  private updateProgramSources(fileNames: string[]) {
    this.watchProgram.updateRootFileNames(fileNames);
    this.program = this.watchProgram.getProgram().getProgram();
  }

  private createEnvironment(): VirtualTypeScriptEnvironment {
    const targetSystem =
      fs.existsSync(this.root) && fs.statSync(this.root).isDirectory()
        ? createFSBackedSystem(this.fsMap, this.root, ts)
        : createSystem(this.fsMap);
    const env = createVirtualTypeScriptEnvironment(
      targetSystem,
      [],
      ts,
      this.getCompilerOptions()
    );
    env.sys.write = (_s) => { }; // maybe include logging?
    env.sys.getExecutingFilePath = () => this.root;
    env.sys.createDirectory = (_path) => { };
    env.sys.deleteFile = (name) => {
      this.fsMap.delete(name);
    };

    return env;
  }

  private createDefaultMap(): Map<string, string> {
    return createDefaultMapFromNodeModules({
      target: ts.ScriptTarget.ES2016,
    });
  }

  private getCompilerOptions(): CompilerOptions {
    return Object.assign(
      {},
      this._defaultCompilerOptions,
      this.compilerOptions
    );
  }
}


const vfs = new TypeScriptVFS("../CodeGen/Source/WebService/bin/Debug/net6.0/empty-webcomponents-project");
const sourceFiles = vfs.getSourceFiles();
const a = 5;
vfs.createFile("testing.ts", "const test = 5;");
vfs.deleteFile("testing.ts");
const test = vfs.directoryExists("src");
const b = 6;
