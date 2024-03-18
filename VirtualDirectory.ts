import { ISourceManager } from "./ISourceManager";
import { VirtualFile } from "./VirtualFile";
import { FORWARD_SLASH_TOKEN } from "./global-constants";
import path from "path";
import { VFSLanguageService } from "./types";

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
        this.name = path.posix.normalize(name).substring(name.lastIndexOf(FORWARD_SLASH_TOKEN) + 1) || this.name;
    }

    public get languageService(): VFSLanguageService | undefined {
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
