import ts, { CompilerOptions } from "typescript";
import * as fs from "fs";
import {
    VirtualTypeScriptEnvironment,
    createFSBackedSystem,
    createSystem,
    createVirtualTypeScriptEnvironment,
    createVirtualLanguageServiceHost
} from "@typescript/vfs";
import { ISourceManager } from "../types";

export class TypeScriptSourceManager implements ISourceManager {
    constructor(
        private readonly root: string,
        private filesMap: Map<string, string>,
        private readonly compilerOptions: CompilerOptions
    ) { }

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

    public getSourceString(sourceFile: ts.SourceFile, options?: ts.PrinterOptions, handlers?: ts.PrintHandlers): string {
        const printer = ts.createPrinter(options, handlers);
        return printer.printFile(sourceFile);
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
