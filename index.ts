import * as fs from "fs";
import * as path from "path";
import ts, { CompilerOptions } from "typescript";

import {
  VirtualTypeScriptEnvironment,
  createDefaultMapFromNodeModules,
  createFSBackedSystem,
  createSystem,
  createVirtualTypeScriptEnvironment,
} from "@typescript/vfs";

const DOT_TOKEN = ".";

export class TypeScriptVFS {
  constructor(
    public root = DOT_TOKEN,
    public compilerOptions: CompilerOptions = {},
    public rootFiles = []
  ) {
    if (root != DOT_TOKEN) {
      this.readFilesFromDirectory(root);
    }
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
  public get program() {
    if (!this._program) {
      this._program = this.watchProgram.getProgram().getProgram();
    }
    return this._program;
  }
  private set program(program: ts.Program) {
    this._program = program;
  }

  private _host: ts.WatchCompilerHostOfFilesAndCompilerOptions<ts.SemanticDiagnosticsBuilderProgram> | undefined;
  public get host(): ts.WatchCompilerHostOfFilesAndCompilerOptions<ts.SemanticDiagnosticsBuilderProgram> {
    if (!this._host) {
      this._host = ts.createWatchCompilerHost(
        [...this.rootFiles, ...this.fsMap.keys()],
        this.getCompilerOptions(),
        this.environment.sys
      );
    }
    return this._host;
  }

  public createFile(name: string, content: string): void {
    const fullName = path.posix.join(this.root, name);
    this.fsMap.set(fullName, content);
    this.environment.createFile(fullName, content);
    this.updateProgramSources([...this.fsMap.keys()]);
  }

  public fileExists(name: string): boolean {
    return this.host.fileExists(path.posix.join(this.root, name));
  }

  public readFile(name: string): string | undefined {
    return this.host.readFile(path.posix.join(this.root, name));
  }

  public deleteFile(name: string): void {
    const fullName = path.posix.join(this.root, name);
    this.environment.sys.deleteFile!(fullName);
    this.updateProgramSources([...this.fsMap.keys()]);
  }

  public directoryExists(name: string): boolean {
    return this.host.directoryExists!(
      path.posix.join(this.root, name)
    );
  }

  private readFilesFromDirectory(directory: string): void {
    if (!fs.statSync(directory).isDirectory()) return;
    const files = fs.readdirSync(directory);
    for (const file of files) {
      const filePath = path.posix.join(directory, file);
      if (fs.statSync(filePath).isDirectory()) {
        this.readFilesFromDirectory(filePath);
      } else {
        this.fsMap.set(filePath, fs.readFileSync(filePath, "utf8"));
      }
    }
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
      [...this.rootFiles],
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

const root =
  "../CodeGen/Source/WebService/bin/Debug/net6.0/empty-webcomponents-project";
const vfs = new TypeScriptVFS(root);
const sourceFiles = vfs.program.getSourceFiles().filter((sf) => sf.fileName.includes(root));
vfs.createFile("testing.ts", "const test = 5;");
const a = 5;
vfs.deleteFile("testing.ts");
const test = vfs.directoryExists("src");
const b = 6;
