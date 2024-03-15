import * as fs from "fs";
import ts, { CompilerOptions } from "typescript";

import { createDefaultMapFromNodeModules } from "@typescript/vfs";
import { ISourceManager } from "./ISourceManager";
import { TypeScriptSourceManager } from "./TypeScriptSourceManager";
import { VirtualDirectory } from "./VirtualDirectory";
import { VirtualFile } from "./VirtualFile";
import { FORWARD_SLASH_TOKEN, NODE_MODULES, SUPPORTED_EXTENSIONS } from "./global-constants";
import path from "path";
import { FileState } from "./types";

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

export class TypeScriptVFS implements IFileSystem {
    constructor(
        public readonly root = FORWARD_SLASH_TOKEN,
        private readonly compilerOptions: CompilerOptions = {},
        private _sourceManager?: ISourceManager,
        private readonly supportedExtensions = SUPPORTED_EXTENSIONS
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
            try {
                this._rootDir = this.loadPhysicalDirectoryToVirtual(
                    this.root,
                    new VirtualDirectory(this.root, null, this.sourceManager)
                );
            } catch (err) {
                this._rootDir = new VirtualDirectory(this.root, null, this.sourceManager);
            }
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
            throw new Error(`File ${filePath} not found.`);
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
        this.flush();
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

        if (this.root !== FORWARD_SLASH_TOKEN) {
            try {
                this.updateFilesOnDisc();
            }
            catch (err) {
                throw new Error(`Could not apply virtual file system changes to ${this.root}.`);
            }
        }
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
            if (this.supportedExtensions.includes(`.${file.extension}`)) {
                fsMap.set(file.path, file.content);
            }
        });

        return fsMap;
    }

    private loadPhysicalDirectoryToVirtual(physicalDirPath: string, virtualDir: VirtualDirectory) {
        const entries = fs.readdirSync(physicalDirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === NODE_MODULES) continue;
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
