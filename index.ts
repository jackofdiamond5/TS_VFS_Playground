import * as fs from "fs";
import * as path from "path";
import ts, { CompilerOptions } from "typescript";

import {
  VirtualTypeScriptEnvironment,
  createDefaultMapFromNodeModules,
  createFSBackedSystem,
  createSystem,
  createVirtualCompilerHost,
  createVirtualTypeScriptEnvironment,
} from "@typescript/vfs";

export interface ITypeScriptVFSHost {
  compilerHost: ts.CompilerHost;
  updateFile: (sourceFile: ts.SourceFile) => boolean;
}

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

  private _environment!: VirtualTypeScriptEnvironment;
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

  private _fsMap!: Map<string, string>;
  public get fsMap() {
    if (!this._fsMap) {
      this._fsMap = this.createDefaultMap();
    }

    return this._fsMap;
  }

  private _program!: ts.Program;
  public get program() {
    if (!this._program) {
      this._program = ts.createProgram({
        rootNames: [...this.fsMap.keys()],
        options: this.getCompilerOptions(),
        host: this.host.compilerHost,
      });
      this._program.emit();
    }

    return this._program;
  }

  private _host!: ITypeScriptVFSHost;
  public get host(): ITypeScriptVFSHost {
    if (!this._host) {
      this._host = createVirtualCompilerHost(
        this.environment.sys,
        this.getCompilerOptions(),
        ts
      );
    }
    return this._host;
  }

  public createFile(name: string, content: string): void {
    this.environment.createFile(path.posix.join(this.root, name), content);
  }

  public fileExists(name: string): boolean {
    return this.host.compilerHost.fileExists(path.posix.join(this.root, name));
  }

  public readFile(name: string): string | undefined {
    return this.host.compilerHost.readFile(path.posix.join(this.root, name));
  }

  public deleteFile(name: string): void {
    this.environment.sys.deleteFile!(path.posix.join(this.root, name));
  }

  public directoryExists(name: string): boolean {
    return this.host.compilerHost.directoryExists!(
      path.posix.join(this.root, name)
    );
  }

  public readFilesFromDirectory(directory: string): void {
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

  private createEnvironment(): VirtualTypeScriptEnvironment {
    const targetSystem =
      fs.existsSync(this.root) && fs.statSync(this.root).isDirectory()
        ? createFSBackedSystem(this.fsMap, this.root, ts)
        : createSystem(this.fsMap);
    return createVirtualTypeScriptEnvironment(
      targetSystem,
      [...this.rootFiles],
      ts,
      this.getCompilerOptions()
    );
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

const vfs = new TypeScriptVFS(
  "../CodeGen/Source/WebService/bin/Debug/net6.0/empty-webcomponents-project"
);
const sourceFiles = vfs.program.getSourceFiles();
const test = 5;
