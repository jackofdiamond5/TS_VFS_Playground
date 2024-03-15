import * as fs from "fs";
import * as path from "path";
import ts, { CompilerOptions } from "typescript";

import {
  VirtualTypeScriptEnvironment,
  createDefaultMapFromNodeModules,
  createFSBackedSystem,
  createSystem,
  createVirtualLanguageServiceHost,
  createVirtualTypeScriptEnvironment
} from "@typescript/vfs";

const DOT_TOKEN = ".";
const FORWARD_SLASH_TOKEN = "/";
const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.cts', '.d.cts', '.mts', '.d.mts'];

export enum FileState {
  New = 'new',
  Modified = 'modified',
  Deleted = 'deleted'
}

export interface ISourceManager {
  getSourceFile(filePath: string, content: string): ts.SourceFile | undefined;
  updateEnvironment(filesMap: Map<string, string>): void;
  get languageService(): ts.LanguageService | undefined;
}

export interface IFileSystem {
  fileExists(filePath: string): boolean;
  readFile(filePath: string, encoding?: string): string;
  writeFile(filePath: string, text: string): void;
  directoryExists(dirPath: string): boolean;

  /**
   * Returns a list of file paths under a directory based on a match pattern
   * @param dirPath Root dir to search in
   * @param pattern Pattern to match
   */
  glob(dirPath: string, pattern: string): string[];
}

export class TypeScriptSourceManager implements ISourceManager {
  constructor(
    private readonly root: string,
    private filesMap: Map<string, string>,
    private readonly compilerOptions: CompilerOptions) { }

  private _languageServiceHost: ts.LanguageServiceHost | undefined;
  private get languageServiceHost(): ts.LanguageServiceHost {
    if (!this._languageServiceHost) {
      this._languageServiceHost = this.createLanguageServiceHost();
    }

    return this._languageServiceHost;
  }

  private _environment: VirtualTypeScriptEnvironment | undefined;
  private get environment(): VirtualTypeScriptEnvironment {
    if (!this._environment) {
      this._environment = this.createEnvironment();
    }
    return this._environment;
  }

  public get languageService(): ts.LanguageService | undefined {
    return ts.createLanguageService(this.languageServiceHost, ts.createDocumentRegistry());
  }

  public getSourceFile(filePath: string, content: string): ts.SourceFile | undefined {
    return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  }

  public updateEnvironment(filesMap: Map<string, string>): void {
    this.filesMap = filesMap;
    this._environment = this.createEnvironment();
    this._languageServiceHost = this.createLanguageServiceHost();
  }

  private createEnvironment(): VirtualTypeScriptEnvironment {
    const targetSystem =
      fs.existsSync(this.root) && fs.statSync(this.root).isDirectory()
        ? createFSBackedSystem(this.filesMap, this.root, ts)
        : createSystem(this.filesMap);
    const env = createVirtualTypeScriptEnvironment(
      targetSystem,
      [],
      ts,
      this.compilerOptions
    );

    //#region these methods are not implemented in the virtual environment
    // not needed atm but might be useful to implement them in the future
    env.sys.write = (_s) => { }; // maybe include logging?
    env.sys.getExecutingFilePath = () => '';
    env.sys.createDirectory = (_path) => { };
    env.sys.deleteFile = (_name) => { };
    //#endregion

    return env;
  }

  private createLanguageServiceHost(): ts.LanguageServiceHost {
    return createVirtualLanguageServiceHost(
      this.environment.sys,
      [...this.filesMap.keys()],
      this.compilerOptions,
      ts
    )
      .languageServiceHost;
  }
}

export class VirtualDirectory {
  public readonly subDirs: Map<string, VirtualDirectory>;
  public readonly files: Map<string, VirtualFile>;
  public readonly path: string = '/';

  constructor(
    public readonly name: string,
    public readonly parentDir: VirtualDirectory | null,
    public readonly sourceManager?: ISourceManager
  ) {
    this.subDirs = new Map<string, VirtualDirectory>();
    this.files = new Map<string, VirtualFile>();
    if (parentDir) {
      this.path = path.posix.join(parentDir.path + FORWARD_SLASH_TOKEN, name);
    }
    this.name = path.posix.normalize(name).substring(name.lastIndexOf(FORWARD_SLASH_TOKEN) + 1);
  }

  public get languageService(): ts.LanguageService | undefined {
    return this.sourceManager?.languageService;
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

  public addSubDirectory(dirPath: string, sourceManager: ISourceManager): VirtualDirectory {
    const parts = dirPath.split(FORWARD_SLASH_TOKEN).filter(p => p.length);
    let currentDir: VirtualDirectory = this;
    parts.forEach(part => {
      if (!currentDir.subDirs.has(part)) {
        const newDir = new VirtualDirectory(part, currentDir, sourceManager);
        currentDir.subDirs.set(part, newDir);
        currentDir = newDir;
      } else {
        currentDir = currentDir.subDirs.get(part)!;
      }
    });

    return currentDir;
  }

  public removeSubDirectory(dirPath: string): boolean {
    const parts = dirPath.split(FORWARD_SLASH_TOKEN).filter(p => p.length);
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

    const containingDir = this.findSubDirectory(parts.join(FORWARD_SLASH_TOKEN)) || this;
    if (fileName) {
      return containingDir.files.get(fileName) || null;
    }

    return null;
  }

  public addFile(filePath: string, content: string): VirtualFile {
    const parts = filePath.split(FORWARD_SLASH_TOKEN);
    const fileName = parts.pop();
    const directory = this.addSubDirectory(parts.join(FORWARD_SLASH_TOKEN), this.sourceManager!);

    if (fileName) {
      // const newFile = new VirtualFile(fileName, content, directory.path + FORWARD_SLASH_TOKEN, this.sourceManager);
      const newFile = new VirtualFile(fileName, content, directory);
      directory.files.set(fileName, newFile);
      return newFile;
    } else {
      throw new Error('File name must be provided');
    }
  }

  public removeFile(searchPath: string): boolean {
    const file = this.findFile(searchPath);
    if (file) {
      return file.parentDir.files.delete(file.name);
    }

    return false;
  }
}

export class VirtualFile {
  public readonly path: string = '';
  public readonly extension: string = '';

  constructor(
    public readonly name: string,
    private _content: string,
    public readonly parentDir: VirtualDirectory
  ) {
    this.extension = this.getExtension(name);
    this.path = path.posix.join(parentDir.path + FORWARD_SLASH_TOKEN, name);
  }

  public get sourceFile(): ts.SourceFile | undefined {
    return this.parentDir.sourceManager?.getSourceFile(this.path, this.content);
  }

  public get content(): string {
    return this._content;
  }

  public updateContent(newContent: string): void {
    this._content = newContent;
  }

  public updateSourceFile(): void {
    // TODO: use the TypeScriptFileUpdate to modify the actual AST of the file and then update the VFS
    throw new Error('Not implemented');
  }

  private getExtension(fileName: string): string {
    const dotIndex = fileName.lastIndexOf(DOT_TOKEN);
    if (dotIndex === -1) return '';
    return fileName.substring(dotIndex + 1);
  }
}

export class TypeScriptVFS implements IFileSystem {
  constructor(
    public readonly root = DOT_TOKEN,
    private readonly compilerOptions: CompilerOptions = {},
    private _sourceManager?: ISourceManager
  ) { }

  private readonly _defaultCompilerOptions: CompilerOptions = {
    baseUrl: this.root,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.Latest,
    esModuleInterop: true,
    lib: ["es2018", "dom"]
  };

  private readonly _watchedFilesMap: Map<FileState, string> = new Map<FileState, string>();

  private get sourceManager(): ISourceManager {
    if (!this._sourceManager) {
      this._sourceManager = new TypeScriptSourceManager(this.root, this.fsMap, this.getCompilerOptions());
    }
    return this._sourceManager;
  }

  private _rootDir: VirtualDirectory | undefined;
  public get rootDir(): VirtualDirectory {
    if (!this._rootDir) {
      this._rootDir = this.loadPhysicalDirectoryToVirtual(
        this.root,
        new VirtualDirectory(this.root, null, this.sourceManager)
      );
      this.flush();
    }
    return this._rootDir;
  }

  private _fsMap: Map<string, string> | undefined;
  private get fsMap() {
    if (!this._fsMap) {
      this._fsMap = this.createDefaultMap();
    }
    return this._fsMap;
  }

  public createFile(name: string, content: string): VirtualFile {
    const newFile = this.rootDir.addFile(name, content);
    this._watchedFilesMap.set(FileState.New, newFile.path);
    this.flush();
    return newFile;
  }

  public fileExists(filePath: string): boolean {
    return this.rootDir.findFile(filePath) !== null;
  }

  public findFile(filePath: string): VirtualFile | null {
    return this.rootDir.findFile(filePath) || null;
  }

  public readFile(filePath: string): string {
    const file = this.rootDir.findFile(filePath);
    if (!file) {
      throw new Error(`File ${filePath} not found`);
    }

    return file.content;
  }

  public writeFile(filePath: string, content: string): VirtualFile | null {
    const file = this.rootDir.findFile(filePath);
    if (file) {
      file.updateContent(content);
      this._watchedFilesMap.set(FileState.Modified, file.path);
      this.flush();
    }

    return file;
  }

  public findFiles(fileName: string): VirtualFile[] {
    return this.rootDir?.findFiles(fileName) || [];
  }


  public deleteFile(filePath: string): boolean {
    const key = Array.from(this._watchedFilesMap.keys()).find(k => k.includes(filePath));
    if (key) {
      this._watchedFilesMap.delete(key);
    }

    const success = this.rootDir.removeFile(key || filePath);
    if (success) {
      this.flush();
      this._watchedFilesMap.set(FileState.Deleted, key || filePath);
    }

    return success;
  }

  public addDirectory(dirPath: string): VirtualDirectory {
    return this.rootDir.addSubDirectory(dirPath, this.sourceManager);
  }

  public directoryExists(name: string): boolean {
    return this.rootDir.findSubDirectory(name) !== undefined;
  }

  public glob(dirPath: string, pattern: string): string[] {
    const dir = this.rootDir.findSubDirectory(dirPath);
    const entries: string[] = [];
    pattern = pattern.split("**/*").pop() || pattern;
    dir?.files.forEach((file) => {
      if (file.path.endsWith(pattern)) {
        entries.push(file.path);
      }
    });

    return entries;
  }

  public getSourceFiles(): readonly ts.SourceFile[] {
    return this.sourceManager?.languageService?.getProgram()?.getSourceFiles() || [];
  }

  public clear(): void {
    this._rootDir = this.loadPhysicalDirectoryToVirtual(
      this.root,
      new VirtualDirectory(this.root, null, this.sourceManager)
    );
    this.flush();
  }

  public finalize(): void;
  public finalize(outPath: string): void;
  public finalize(outPath?: string): void {
    this.flush();
    if (outPath) {
      const rootDirPath = path.posix.normalize(path.posix.join(outPath, this.rootDir.name));
      fs.mkdirSync(rootDirPath, { recursive: true });
      this.writeDirToFS(rootDirPath);
      return;
    }

    this.updateFilesOnDisc();
  }

  private updateFilesOnDisc(): void {
    for (const kvp of this._watchedFilesMap) {
      const file = this.rootDir.findFile(kvp[1]);
      switch (kvp[0]) {
        case FileState.New:
        case FileState.Modified:
          if (file) {
            fs.writeFileSync(path.posix.join(this.root, file.path), file.content);
          }
          break;
        case FileState.Deleted:
          const filePath = path.posix.join(this.root, file?.path || kvp[1]);
          if (file || fs.existsSync(filePath)) {
            fs.rmSync(path.posix.normalize(filePath));
          }
          break;
      }
    }
    this._watchedFilesMap.clear();
  }

  private writeDirToFS(normalizedOutPath: string, dir?: VirtualDirectory): void {
    dir = dir || this.rootDir;
    dir.subDirs.forEach((subdir) => {
      const subDirPath = path.posix.join(normalizedOutPath, subdir.name);
      fs.mkdirSync(subDirPath, { recursive: true });
      this.writeDirToFS(subDirPath, subdir);
    });

    dir.files.forEach((file) => {
      fs.writeFileSync(path.posix.join(normalizedOutPath, file.name), file.content);
    });
  }

  private flush(): void {
    this._fsMap = this.convertToFsMap(this.rootDir);
    this.sourceManager?.updateEnvironment(this.fsMap);
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
        const newVirtualDir = virtualDir.addSubDirectory(entry.name, this.sourceManager);
        this.loadPhysicalDirectoryToVirtual(entryPath, newVirtualDir);
      } else if (entry.isFile()) {
        const fileContent = fs.readFileSync(entryPath, 'utf8');
        virtualDir.addFile(entry.name, fileContent);
      }
    }

    return virtualDir;
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

const dir1 = "C:/Users/bpenkov/Downloads/empty-webcomponents-project"
const dir2 = "../CodeGen/Source/WebService/bin/Debug/net6.0/empty-webcomponents-project";
const vfs = new TypeScriptVFS(dir2);

// const file = vfs.findFile("src/app/app-routing.ts");
// const sf = file?.sourceFile;
// const c = vfs.finalize("C:/Users/bpenkov/Downloads");
// const fileRefs = file?.parentDir.languageService?.getFileReferences(file.path);
// const sourceFiles = vfs.getSourceFiles();
// const a = 5;

vfs.createFile("/src/testing.ts", "const test = 5;");
vfs.writeFile("src/testing.ts", "const test = 6;");

// bug
vfs.createFile("rootTesting.ts", "const rootTesting = 5;");
vfs.deleteFile("rootTesting.ts");

vfs.deleteFile("src/index.ts");

vfs.finalize();
// vfs.deleteFile("testing.ts");
// const test = vfs.directoryExists("src");
const b = 6;
