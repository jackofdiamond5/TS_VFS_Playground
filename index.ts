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
const FORWARD_SLASH_TOKEN = "/";
const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.cts', '.d.cts', '.mts', '.d.mts'];

export class VirtualDirectory {
  public readonly subDirs: Map<string, VirtualDirectory>;
  public readonly files: Map<string, VirtualFile>;
  public path: string = '';

  constructor(public name: string, parentPath: string = '') {
    this.subDirs = new Map();
    this.files = new Map();
    this.path = path.posix.join(parentPath, name);
    this.name = path.posix.normalize(name).substring(name.lastIndexOf(FORWARD_SLASH_TOKEN) + 1);
  }

  public findSubDirectory(searchPath: string): VirtualDirectory | undefined {
    const normalizedSearchPath = path.posix.normalize(searchPath);
    const parts = normalizedSearchPath.split(FORWARD_SLASH_TOKEN).filter(p => p.length);
    let currentDir: VirtualDirectory | undefined = this;

    for (const part of parts) {
      if (currentDir?.subDirs.has(part)) {
        currentDir = currentDir.subDirs.get(part);
      } else {
        return undefined;
      }
    }

    return currentDir;
  }

  public addSubDirectory(path: string): VirtualDirectory {
    const parts = path.split(FORWARD_SLASH_TOKEN).filter(p => p.length);
    let currentDir: VirtualDirectory = this;
    parts.forEach(part => {
      if (!currentDir.subDirs.has(part)) {
        const newDir = new VirtualDirectory(part, currentDir.path + FORWARD_SLASH_TOKEN);
        currentDir.subDirs.set(part, newDir);
        currentDir = newDir;
      } else {
        currentDir = currentDir.subDirs.get(part)!;
      }
    });

    return currentDir;
  }

  public removeSubDirectory(path: string): boolean {
    const parts = path.split(FORWARD_SLASH_TOKEN).filter(p => p.length);
    let currentDir: VirtualDirectory | undefined = this;
    for (const part of parts) {
      currentDir = currentDir.subDirs.get(part);
      if (!currentDir) return false;
    }

    return currentDir.subDirs.delete(parts.pop()!);
  }

  public findFiles(fileName: string): VirtualFile[] {
    let foundFiles: VirtualFile[] = [];

    if (this.files.has(fileName)) {
      foundFiles.push(this.files.get(fileName)!);
    }

    this.subDirs.forEach(subdir => {
      foundFiles = foundFiles.concat(subdir.findFiles(fileName));
    });

    return foundFiles;
  }

  public findFile(searchPath: string): VirtualFile | null {
    const normalizedSearchPath = path.posix.normalize(searchPath);
    const parts = normalizedSearchPath.split(FORWARD_SLASH_TOKEN).filter(p => p.length);
    const fileName = parts.pop();

    const containingDir = this.findSubDirectory(parts.join(FORWARD_SLASH_TOKEN));
    if (fileName && containingDir) {
      return containingDir.files.get(fileName) || null;
    }

    return null;
  }

  public addFile(path: string, content: string): VirtualFile {
    const parts = path.split(FORWARD_SLASH_TOKEN);
    const fileName = parts.pop();
    const directory = this.addSubDirectory(parts.join(FORWARD_SLASH_TOKEN));

    if (fileName) {
      const newFile = new VirtualFile(fileName, content, directory.path + FORWARD_SLASH_TOKEN);
      directory.files.set(fileName, newFile);
      return newFile;
    } else {
      throw new Error('File name must be provided');
    }
  }

  public removeFile(searchPath: string): boolean {
    const normalizedSearchPath = path.posix.normalize(searchPath);
    const parts = normalizedSearchPath.split(FORWARD_SLASH_TOKEN).filter(p => p.length);
    const fileName = parts.pop();
    const containingDir = this.findSubDirectory(parts.join(FORWARD_SLASH_TOKEN));
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
  constructor(public root = DOT_TOKEN, private compilerOptions: CompilerOptions = {}) { }

  private readonly _defaultCompilerOptions: CompilerOptions = {
    baseUrl: this.root,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.Latest,
    esModuleInterop: true,
    lib: ["es2018", "dom"]
  };

  private _rootDir: VirtualDirectory | undefined;
  public get rootDir(): VirtualDirectory {
    if (!this._rootDir) {
      this._rootDir = this.loadPhysicalDirectoryToVirtual(
        this.root,
        new VirtualDirectory(this.root, FORWARD_SLASH_TOKEN)
      );
    }
    return this._rootDir;
  }

  private _environment: VirtualTypeScriptEnvironment | undefined;
  private get environment(): VirtualTypeScriptEnvironment {
    if (!this._environment) {
      this._environment = this.createEnvironment();
    }
    return this._environment;
  }

  private _fsMap: Map<string, string> | undefined;
  private get fsMap() {
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
    return this.rootDir.addFile(name, content);
  }

  public fileExists(name: string): boolean {
    return this.rootDir.findFile(name) !== null;
  }

  public read(fileName: string): string | undefined {
    return this.rootDir.findFile(fileName)?.content;
  }

  public overwrite(fileName: string, content: string): VirtualFile | null {
    const file = this.rootDir.findFile(fileName);
    if (file) {
      file.updateContent(content);
    }

    return file;
  }

  public findFiles(fileName: string): VirtualFile[] {
    return this.rootDir?.findFiles(fileName) || [];
  }

  public deleteFile(name: string): boolean {
    return this.rootDir.removeFile(name);
  }

  public directoryExists(name: string): boolean {
    return this.rootDir.findSubDirectory(name) !== undefined;
  }

  public getSourceFiles(): readonly ts.SourceFile[] {
    this.flush();
    return this.program
      .getSourceFiles()
      .filter((sf) => sf.fileName.includes(path.posix.resolve(this.root)));
  }

  public clear(): void {
    this._rootDir = this.loadPhysicalDirectoryToVirtual(
      this.root,
      new VirtualDirectory(this.root, FORWARD_SLASH_TOKEN)
    );
    this.flush();
  }

  public writeOnDisc(outPath: string): void {
    this.flush();
    const rootDirPath = path.posix.normalize(path.posix.join(outPath, this.rootDir.name));
    fs.mkdirSync(rootDirPath, { recursive: true });
    this.writeDataOnDisc(rootDirPath);
  }

  private writeDataOnDisc(normalizedOutPath: string, dir?: VirtualDirectory): void {
    dir = dir || this.rootDir;
    dir.subDirs.forEach((subdir) => {
      const subDirPath = path.posix.join(normalizedOutPath, subdir.name);
      fs.mkdirSync(subDirPath, { recursive: true });
      this.writeDataOnDisc(subDirPath, subdir);
    });

    dir.files.forEach((file) => {
      fs.writeFileSync(path.posix.join(normalizedOutPath, file.name), file.content);
    });
  }

  private flush(): void {
    this._fsMap = this.convertToFsMap(this.rootDir);
    this.updateProgramSources([...this.fsMap.keys()]);
    this.updateSourceFiles(this.rootDir, this.program);
  }

  private updateSourceFiles(dir: VirtualDirectory, program: ts.Program) {
    dir.files.forEach((file) => {
      file.updateSourceFile(program);
    });

    dir.subDirs.forEach((subdir) => {
      this.updateSourceFiles(subdir, program);
    });
  }

  private convertToFsMap(dir: VirtualDirectory, fsMap: Map<string, string> = new Map()): Map<string, string> {
    dir.subDirs.forEach((subdir) => {
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
        const newVirtualDir = virtualDir.addSubDirectory(entry.name);
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
      target: ts.ScriptTarget.Latest,
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
const c = vfs.writeOnDisc("C:/Users/bpenkov/Downloads");
// const sourceFiles = vfs.getSourceFiles();
const a = 5;
vfs.createFile("testing.ts", "const test = 5;");
vfs.deleteFile("testing.ts");
const test = vfs.directoryExists("src");
const b = 6;
