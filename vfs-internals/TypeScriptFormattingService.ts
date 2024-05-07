import ts from "typescript";
import { IFormattingService, IFormatSettings } from "../types";
import { IFileSystem } from "../types/IFileSystem";
import { TypeScriptUtils } from "./Temp";

export class TypeScriptFormattingService implements IFormattingService {
  private _sourceFile!: ts.SourceFile;
  private _formatSettingsFromConfig: IFormatSettings = {};
  private _defaultFormatSettings: IFormatSettings = {
    indentSize: 4,
    tabSize: 4,
    newLineCharacter: ts.sys.newLine,
    convertTabsToSpaces: true,
    indentStyle: ts.IndentStyle.Smart,
    insertSpaceAfterCommaDelimiter: true,
    insertSpaceAfterSemicolonInForStatements: true,
    insertSpaceBeforeAndAfterBinaryOperators: true,
    insertSpaceAfterKeywordsInControlFlowStatements: true,
    insertSpaceAfterTypeAssertion: true,
    singleQuotes: true,
  };


  /**
   * Create a new formatting service for the given source file.
   * @param path Path to the source file to format.
   * @param formatSettings Custom formatting settings to apply.
   * @param compilerOptions Compiler options to use when transforming the source file.
   */
  constructor(
    public path: string,
    private readonly fileSystem: IFileSystem,
    private readonly formatSettings?: IFormatSettings,
    private readonly compilerOptions?: ts.CompilerOptions
  ) {}

  private getFileSource(filePath: string): ts.SourceFile {
    let targetFile = this.fileSystem.readFile(filePath);
    targetFile = targetFile!.replace(/(\r?\n)(\r?\n)/g, `$1${"//I keep the new line"}$2`);
    const targetSource = TypeScriptUtils.createSourceFile(filePath, targetFile, ts.ScriptTarget.Latest, true);
    return targetSource;
  }

  /**
   * Apply formatting to the source file.
   */
  public applyFormatting(): string {
    this.readFormatConfigs();
    this._sourceFile = this.getFileSource(this.path);
    
    if (this.formatOptions.singleQuotes) {
      this._sourceFile = ts.transform(this._sourceFile, [this.convertQuotesTransformer], this.compilerOptions).transformed[0];
    }

    const changes = this.languageService.getFormattingEditsForDocument(this._sourceFile.fileName, this.formatOptions);
    const text = this.applyChanges(TypeScriptUtils.getSourceText(this._sourceFile), changes);
    return text;
  }

  /**
   * The format options to use when printing the source file.
   */
  public get formatOptions(): IFormatSettings {
    return Object.assign({}, this._defaultFormatSettings, this._formatSettingsFromConfig, this.formatSettings);
  }

  /**
   * The language service host used to access the source file.
   */
  private _languageServiceHost: ts.LanguageServiceHost | undefined;
  private get languageServiceHost(): ts.LanguageServiceHost {
    if (!this._languageServiceHost) {
      this._languageServiceHost = this.createLanguageServiceHost();
    }

    return this._languageServiceHost;
  }

  /**
   * The language service instance used to format the source file.
   */
  private get languageService(): ts.LanguageService {
    return ts.createLanguageService(this.languageServiceHost, ts.createDocumentRegistry());
  }

  /**
   * Create a language service host for the source file.
   * The host is used by TS to access the FS and read the source file.
   * In this case we are operating on a single source file so we only need to provide its name and contents.
   */
  private createLanguageServiceHost(): ts.LanguageServiceHost {
    const servicesHost: ts.LanguageServiceHost = {
      getCompilationSettings: () => ({}),
      getScriptFileNames: () => [this.path],
      getScriptVersion: (_fileName) => "0",
      getScriptSnapshot: (_fileName) => {
        return ts.ScriptSnapshot.fromString(TypeScriptUtils.getSourceText(this._sourceFile));
      },
      getCurrentDirectory: () => process.cwd(),
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      readDirectory: () => [],
      readFile: () => undefined,
      fileExists: () => true,
    };
    return servicesHost;
  }

  /**
   * Transform string literals to use single quotes.
   */
  private convertQuotesTransformer =
    <T extends ts.Node>(context: ts.TransformationContext) =>
    (rootNode: T): ts.SourceFile => {
      const visit = (node: ts.Node): ts.Node => {
        if (ts.isStringLiteral(node)) {
          return context.factory.createStringLiteral(node.text, this.formatOptions.singleQuotes);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(rootNode, visit, ts.isSourceFile);
    };

  /**
   * Apply formatting changes (position based) in reverse
   * from https://github.com/Microsoft/TypeScript/issues/1651#issuecomment-69877863
   */
  private applyChanges(orig: string, changes: ts.TextChange[]): string {
    let result = orig;
    for (let i = changes.length - 1; i >= 0; i--) {
      const change = changes[i];
      const head = result.slice(0, change.span.start);
      const tail = result.slice(change.span.start + change.span.length);
      result = head + change.newText + tail;
    }

    return result;
  }

  /**
   * Try and parse formatting from project `.editorconfig`
   */
  private readFormatConfigs() {
    const editorConfigPath = ".editorconfig";
    if (this.fileSystem.fileExists(editorConfigPath)) {
      // very basic parsing support
      const text = this.fileSystem.readFile(editorConfigPath, "utf-8");
      if (!text) return;
      const options = text
        .replace(/\s*[#;].*([\r\n])/g, "$1") //remove comments
        .replace(/\[(?!\*\]|\*.ts).+\][^\[]+/g, "") // leave [*]/[*.ts] sections
        .split(/\r\n|\r|\n/)
        .reduce((obj: any, x) => {
          if (x.indexOf("=") !== -1) {
            const pair = x.split("=");
            obj[pair[0].trim()] = pair[1].trim();
          }
          return obj;
        }, {});

      this._formatSettingsFromConfig.convertTabsToSpaces = options["indent_style"] === "space";
      if (options["indent_size"]) {
        this._formatSettingsFromConfig.indentSize = parseInt(options["indent_size"], 10) || this._formatSettingsFromConfig.indentSize;
      }
      if (options["quote_type"]) {
        this._formatSettingsFromConfig.singleQuotes = options["quote_type"] === "single";
      }
    }
    // TODO: consider adding eslint support
  }
}
