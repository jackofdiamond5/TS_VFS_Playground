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

    public addFile(file: VirtualFile): VirtualFile;
    public addFile(filePath: string | VirtualFile, content: string): VirtualFile;
    public addFile(pathOrFile: string | VirtualFile, content: string = ''): VirtualFile {
        if (pathOrFile instanceof VirtualFile) {
            this.files.set(pathOrFile.name, pathOrFile);
            return pathOrFile;
        }

        const parts = pathOrFile.split(FORWARD_SLASH_TOKEN);
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

    public moveFile(file: VirtualFile, target: VirtualDirectory, newFileName?: string): VirtualFile | null {
        const existingFile = target.files.get(file.name);
        const clone = this.cloneFile(newFileName || file.name, file, target);
        let success = true;
        if (existingFile && !newFileName) {
            success = target.removeFile(existingFile) 
                && this.removeFile(file);
        }

        if (success) {
            return target.addFile(clone);
        }

        return null;
    }

    public copyFile(file: VirtualFile, target: VirtualDirectory, newFileName?: string): VirtualFile | null {
        let fileName = file.name;
        const existingFile = target.files.get(fileName);
        if (existingFile && !newFileName) {
            let counter = 1;
            // clean up any (<number>) elements
            const baseName = fileName.replace(/\(\d+\)/, '');
            fileName = `${baseName}(${counter})${file.extension}`;
            while (target.files.has(fileName)) {
                fileName = `${baseName}(${++counter})${file.extension}`;
            }
        }

        const clone = this.cloneFile(newFileName || fileName, file, target);
        return target.addFile(clone);
    }

    private cloneFile(newFileName: string, file: VirtualFile, target: VirtualDirectory): VirtualFile {
        return new VirtualFile(newFileName, file.content, target);
    }

    public removeFile(file: VirtualFile): boolean {
        return this.files.delete(file.name);
    }
}
