import { VirtualDirectory } from "./VirtualDirectory";
import { FORWARD_SLASH_TOKEN, DOT_TOKEN } from "../global-constants";
import path from "path";
import ts from "typescript";

export class VirtualFile {
    public readonly path: string = '';
    public readonly extension: string = '';
  
    constructor(
      public readonly name: string,
      public content: string,
      public readonly parentDir: VirtualDirectory
    ) {
      this.extension = this.getExtension(name);
      this.path = path.posix.join(parentDir.path + FORWARD_SLASH_TOKEN, name);
    }
  
    public get sourceFile(): ts.SourceFile | undefined {
      return this.parentDir.sourceManager?.getSourceFile(this.path, this.content);
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
