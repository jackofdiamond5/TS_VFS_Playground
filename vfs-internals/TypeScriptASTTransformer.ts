import ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { NEW_LINE_PLACEHOLDER } from "../global-constants";
import { Util } from "./Util";

export interface IIdentifier {
  name: string;
  alias?: string;
}

export interface IImport {
  identifierName: string;
  moduleName: string;
  alias?: string;
}

export interface IPropertyAssignment {
  name: string;
  value: ts.Expression;
}

export interface IFormatSettings extends ts.FormatCodeSettings {
  singleQuotes?: boolean;
}

export interface IFormattingService {
  sourceFile: ts.SourceFile;
  applyFormatting(): string;
}

export class FormattingService implements IFormattingService {
  private _printer: ts.Printer | undefined;
  private _formatSettingsFromConfig: IFormatSettings = {};
  private _defaultFormatSettings: IFormatSettings = {
    indentSize: 3,
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
   * The printer instance to use to get the source code from the AST.
   */
  private get printer(): ts.Printer {
    if (!this._printer) {
      this._printer = ts.createPrinter(this.printerOptions);
    }

    return this._printer;
  }

  /**
   * Create a new formatting service for the given source file.
   * @param sourceFile The source file to format.
   * @param cwd The current working directory to use when reading formatting settings.
   * @param formatSettings Custom formatting settings to apply.
   * @param printerOptions Options to use when printing the source file.
   * @param compilerOptions Compiler options to use when transforming the source file.
   */
  constructor(
    public sourceFile: ts.SourceFile,
    // private readonly fileSystem?: IFileSystem, // TODO instead of cwd
    private readonly cwd?: string,
    private readonly formatSettings?: IFormatSettings,
    private readonly printerOptions?: ts.PrinterOptions,
    private readonly compilerOptions?: ts.CompilerOptions
  ) {}

  /**
   * Apply formatting to the source file.
   */
  public applyFormatting(): string {
    this.readFormatConfigs();
    const changes = this.languageService.getFormattingEditsForDocument(
      this.sourceFile.fileName,
      this.formatOptions
    );

    if (this.formatOptions.singleQuotes) {
      this.sourceFile = ts.transform(
        this.sourceFile,
        [this.convertQuotesTransformer],
        this.compilerOptions
      ).transformed[0] as ts.SourceFile;
    }

    const text = this.applyChanges(
      this.printer.printFile(this.sourceFile),
      changes
    );
    // clean source of new line placeholders
    return text.replace(
      new RegExp(
        `(\r?\n)\\s*?${Util.escapeRegExp(NEW_LINE_PLACEHOLDER)}(\r?\n)`,
        "g"
      ),
      `$1$2`
    );
  }

  /**
   * The format options to use when printing the source file.
   */
  public get formatOptions(): IFormatSettings {
    return Object.assign(
      {},
      this._defaultFormatSettings,
      this._formatSettingsFromConfig,
      this.formatSettings
    );
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
    return ts.createLanguageService(
      this.languageServiceHost,
      ts.createDocumentRegistry()
    );
  }

  /**
   * Create a language service host for the source file.
   * The host is used by TS to access the FS and read the source file.
   * In this case we are operating on a single source file so we only need to provide its name and contents.
   */
  private createLanguageServiceHost(): ts.LanguageServiceHost {
    const servicesHost: ts.LanguageServiceHost = {
      getCompilationSettings: () => ({}),
      getScriptFileNames: () => [this.sourceFile.fileName],
      getScriptVersion: (_fileName) => "0",
      getScriptSnapshot: (_fileName) => {
        return ts.ScriptSnapshot.fromString(
          this.printer.printFile(this.sourceFile)
        );
      },
      getCurrentDirectory: () => process.cwd(),
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      readDirectory: ts.sys.readDirectory,
      readFile: ts.sys.readFile,
      fileExists: ts.sys.fileExists,
    };
    return servicesHost;
  }

  /**
   * Transform string literals to use single quotes.
   */
  private convertQuotesTransformer =
    <T extends ts.Node>(context: ts.TransformationContext) =>
    (rootNode: T): ts.Node => {
      const visit = (node: ts.Node): ts.Node => {
        if (ts.isStringLiteral(node)) {
          const text = node.text;
          // the ts.StringLiteral node has a `singleQuote` property that's not part of the public APi for some reason
          // to make our lives easier we can modify it though
          const singleQuote = (node as any).singleQuote;
          const newNode = context.factory.createStringLiteral(text);
          (newNode as any).singleQuote =
            singleQuote || this.formatOptions.singleQuotes;

          return newNode;
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(rootNode, visit);
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
   * Try and parse formatting from project `.editorconfig` / `tslint.json`
   */
  private readFormatConfigs() {
    if (!this.cwd) return;

    const editorConfigPath = path.posix.join(this.cwd, ".editorconfig");
    // TODO: use App.container in the CLI to read the settings from FS
    if (fs.existsSync(editorConfigPath)) {
      // very basic parsing support
      const text = fs.readFileSync(editorConfigPath, "utf-8");
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

      this._formatSettingsFromConfig.convertTabsToSpaces =
        options["indent_style"] === "space";
      if (options["indent_size"]) {
        this._formatSettingsFromConfig.indentSize =
          parseInt(options["indent_size"], 10) ||
          this._formatSettingsFromConfig.indentSize;
      }
      if (options["quote_type"]) {
        this._formatSettingsFromConfig.singleQuotes =
          options["quote_type"] === "single";
      }
    }
    const tsLintPath = path.posix.join(this.cwd, "tslint.json");
    if (fs.existsSync(tsLintPath)) {
      // TODO: eslint?
      // tslint prio - overrides other settings
      const options = JSON.parse(fs.readFileSync(tsLintPath, "utf-8"));
      if (options.rules && options.rules.indent && options.rules.indent[0]) {
        this._formatSettingsFromConfig.convertTabsToSpaces =
          options.rules.indent[1] === "spaces";
        if (options.rules.indent[2]) {
          this._formatSettingsFromConfig.indentSize = parseInt(
            options.rules.indent[2],
            10
          );
        }
      }
      if (
        options.rules &&
        options.rules.quotemark &&
        options.rules.quotemark[0]
      ) {
        this._formatSettingsFromConfig.singleQuotes =
          options.rules.quotemark.indexOf("single") !== -1;
      }
    }
  }
}

export class TypeScriptASTTransformer {
  private _printer: ts.Printer | undefined;
  private _defaultCompilerOptions: ts.CompilerOptions = {
    pretty: true,
  };

  /**
   * The printer instance to use to print the source file after modifications.
   */
  private get printer(): ts.Printer {
    if (!this._printer) {
      this._printer = ts.createPrinter(this.printerOptions);
    }

    return this._printer;
  }

  /**
   * Create a new source update instance for the given source file.
   * @param sourceFile The source file to update.
   * @param formatter The formatting service to use when printing the source file.
   * @param printerOptions Options to use when printing the source file.
   * @param customCompilerOptions Custom compiler options to use when transforming the source file.
   */
  constructor(
    protected sourceFile: ts.SourceFile,
    protected readonly formatter?: IFormattingService,
    protected readonly printerOptions?: ts.PrinterOptions,
    protected readonly customCompilerOptions?: ts.CompilerOptions
  ) {}

  /**
   * The compiler options to use when transforming the source file.
   */
  public get compilerOptions(): ts.CompilerOptions {
    return Object.assign(
      {},
      this._defaultCompilerOptions,
      this.customCompilerOptions
    );
  }

  /**
   * Searches the AST for a variable declaration with the given name and type.
   * @param name The name of the variable to look for.
   * @param type The type of the variable to look for.
   * @returns The variable declaration if found, otherwise `undefined`.
   */
  public findVariableDeclaration(
    name: string,
    type: string
  ): ts.VariableDeclaration | undefined {
    this.flush();
    let declaration;
    ts.forEachChild(this.sourceFile, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText() === name &&
        node.type?.getText() === type
      ) {
        declaration = node;
      } else if (ts.isVariableStatement(node)) {
        declaration = node.declarationList.declarations.find(
          (declaration) =>
            declaration.name.getText() === name &&
            declaration.type?.getText() === type
        );
      }
      // handle variable declaration lists (ts.isVariableDeclarationList)?
      // const a = 5, b = 6...;
    });

    return declaration;
  }

  /**
   * Adds a new property assignment to an object literal expression.
   * @param visitCondition The condition by which the object literal expression is found.
   * @param propertyAssignment The property that will be added.
   */
  public addMemberToObjectLiteral(
    visitCondition: (node: ts.Node) => boolean,
    propertyAssignment: IPropertyAssignment
  ): ts.SourceFile;
  /**
   *
   * @param visitCondition The condition by which the object literal expression is found.
   * @param propertyName The name of the property that will be added.
   * @param propertyValue The value of the property that will be added.
   */
  public addMemberToObjectLiteral(
    visitCondition: (node: ts.Node) => boolean,
    propertyName: string,
    propertyValue: ts.Expression
  ): ts.SourceFile;
  public addMemberToObjectLiteral(
    visitCondition: (node: ts.Node) => boolean,
    propertyNameOrAssignment: string | IPropertyAssignment,
    propertyValue?: ts.Expression
  ): ts.SourceFile {
    let newProperty: ts.PropertyAssignment;
    if (propertyNameOrAssignment instanceof Object) {
      newProperty = ts.factory.createPropertyAssignment(
        propertyNameOrAssignment.name,
        propertyNameOrAssignment.value
      );
    } else if (propertyValue) {
      newProperty = ts.factory.createPropertyAssignment(
        ts.factory.createIdentifier(propertyNameOrAssignment as string),
        propertyValue
      );
    } else {
      throw new Error("Must provide property value.");
    }

    const transformer: ts.TransformerFactory<ts.Node> = <T extends ts.Node>(
      context: ts.TransformationContext
    ) => {
      return (rootNode: T) => {
        const visitor = (node: ts.Node): ts.VisitResult<ts.Node> => {
          if (ts.isObjectLiteralExpression(node) && visitCondition(node)) {
            return context.factory.updateObjectLiteralExpression(node, [
              ...node.properties,
              newProperty,
            ]);
          }
          return ts.visitEachChild(node, visitor, context);
        };
        return ts.visitNode(rootNode, visitor);
      };
    };

    this.sourceFile = ts.transform(
      this.sourceFile,
      [transformer],
      this.compilerOptions
    ).transformed[0] as ts.SourceFile;
    return this.flush();
  }

  /**
   * Update the value of a member in an object literal expression.
   * @param visitCondition The condition by which the object literal expression is found.
   * @param targetMember The member that will be updated. The value should be the new value to set.
   * @returns The mutated AST.
   * @remarks This method will not update nodes that were inserted through the compiler API unless the source file is recreated, see {@link flush}.
   */
  public updateObjectLiteralMember(
    visitCondition: (node: ts.Node) => boolean,
    targetMember: IPropertyAssignment
  ): ts.SourceFile {
    const transformer: ts.TransformerFactory<ts.Node> = <T extends ts.Node>(
      context: ts.TransformationContext
    ) => {
      return (rootNode: T) => {
        const visitor = (node: ts.Node): ts.VisitResult<ts.Node> => {
          if (ts.isObjectLiteralExpression(node) && visitCondition(node)) {
            const newProperties = node.properties.map((property) => {
              const isPropertyAssignment = ts.isPropertyAssignment(property);
              if (
                isPropertyAssignment &&
                (property.pos < 0 || property.end < 0)
              ) {
                // nodes inserted through the compiler API will have pos & end < 0
                // we cannot update them until the source file is flushed (read anew and the nodes are re-created)
                // since pos & end are set during initial parsing and are readonly
                return property;
              }
              if (
                isPropertyAssignment &&
                property.name.getText() === targetMember.name
              ) {
                return context.factory.updatePropertyAssignment(
                  property,
                  property.name,
                  targetMember.value
                );
              }
              return property;
            });

            return context.factory.updateObjectLiteralExpression(
              node,
              newProperties
            );
          }
          return ts.visitEachChild(node, visitor, context);
        };
        return ts.visitNode(rootNode, visitor);
      };
    };

    this.sourceFile = ts.transform(
      this.sourceFile,
      [transformer],
      this.compilerOptions
    ).transformed[0] as ts.SourceFile;
    return this.flush();
  }

  /**
   * Creates a new object literal expression with the given properties.
   * @param properties The properties to add to the object literal.
   */
  public createObjectLiteralExpression(
    properties: IPropertyAssignment[]
  ): ts.ObjectLiteralExpression {
    const propertyAssignments = properties.map((property) =>
      ts.factory.createPropertyAssignment(property.name, property.value)
    );

    return ts.factory.createObjectLiteralExpression(propertyAssignments, true);
  }

  /**
   * Adds a new element to a given array literal expression.
   * @param visitCondition The condition by which the array literal expression is found.
   * @param elements The elements that will be added to the array literal.
   * @param prepend If the elements should be added at the beginning of the array.
   * @returns The mutated AST.
   */
  public addMembersToArrayLiteral(
    visitCondition: (node: ts.Node) => boolean,
    elements: ts.Expression[],
    prepend = false
  ): ts.SourceFile {
    const transformer: ts.TransformerFactory<ts.Node> = <T extends ts.Node>(
      context: ts.TransformationContext
    ) => {
      return (rootNode: T) => {
        const visitor = (node: ts.Node): ts.VisitResult<ts.Node> => {
          if (ts.isArrayLiteralExpression(node) && visitCondition(node)) {
            if (prepend) {
              return context.factory.updateArrayLiteralExpression(node, [
                ...elements,
                ...node.elements,
              ]);
            }
            return context.factory.updateArrayLiteralExpression(node, [
              ...node.elements,
              ...elements,
            ]);
          }
          return ts.visitEachChild(node, visitor, context);
        };
        return ts.visitNode(rootNode, visitor);
      };
    };

    this.sourceFile = ts.transform(
      this.sourceFile,
      [transformer],
      this.compilerOptions
    ).transformed[0] as ts.SourceFile;
    return this.flush();
  }

  /**
   * Create an array literal expression with the given elements.
   * @param elements The elements to include in the array literal.
   * @param multiline Whether the array literal should be multiline.
   */
  public createArrayLiteralExpression(
    elements: ts.Expression[],
    multiline?: boolean
  ): ts.ArrayLiteralExpression;
  public createArrayLiteralExpression(
    elements: IPropertyAssignment[],
    multiline?: boolean
  ): ts.ArrayLiteralExpression;
  public createArrayLiteralExpression(
    elementsOrProperties: ts.Expression[] | IPropertyAssignment[],
    multiline = false
  ): ts.ArrayLiteralExpression {
    if (
      elementsOrProperties.every((element) =>
        ts.isExpression(element as ts.Node)
      )
    ) {
      return ts.factory.createArrayLiteralExpression(
        elementsOrProperties as ts.Expression[],
        multiline
      );
    }

    const propertyAssignments = (
      elementsOrProperties as IPropertyAssignment[]
    ).map((property) => this.createObjectLiteralExpression([property]));
    return ts.factory.createArrayLiteralExpression(
      propertyAssignments,
      multiline
    );
  }

  /**
   * Creates a `ts.Expression` for an identifier with a method call.
   * @param x Identifier text.
   * @param call Method to call, creating `x.call()`.
   * @param typeArgs Type arguments for the call, translates to type arguments for generic methods `myMethod<T>`.
   * @param args Arguments for the call, translates to arguments for the method `myMethod(arg1, arg2)`.
   * @remarks Create `typeArgs` with methods like `ts.factory.createXXXTypeNode`.
   *
   * ```
   * const typeArg = ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
   * const arg = ts.factory.createNumericLiteral('5');
   * const callExpression = update.createCallExpression(
   *    'x',
   *    'myGenericFunction',
   *    [typeArg],
   *    [arg]
   * );
   *
   * // This would create the function call
   * x.myGenericFunction<number>(5)
   * ```
   */
  public createCallExpression(
    x: string,
    call: string,
    typeArgs?: ts.TypeNode[],
    args?: ts.Expression[]
  ): ts.CallExpression {
    return ts.factory.createCallExpression(
      ts.factory.createPropertyAccessExpression(
        ts.factory.createIdentifier(x),
        call
      ),
      typeArgs,
      args
    );
  }

  /**
   * Creates a node for a named import.
   * @param identifiers The identifiers to import.
   * @param modulePath Path to import from.
   * @param isDefault Whether the import is a default import.
   * @returns A named import declaration of the form `import { MyClass } from "my-module"`.
   * @remarks If `isDefault` is `true`, the first element of `identifiers` will be used and
   * the import will be a default import of the form `import MyClass from "my-module"`.
   */
  public createImportDeclaration(
    identifiers: IIdentifier[],
    modulePath: string,
    isDefault: boolean = false
  ): ts.ImportDeclaration {
    let importClause: ts.ImportClause;
    // isTypeOnly on the import clause is set to false because we don't import types atm
    // might change it later if we need sth like - import type { X } from "module"
    // TODO: consider adding functionality for namespaced imports of the form - import * as X from "module"
    if (isDefault) {
      importClause = ts.factory.createImportClause(
        false, // is type only
        ts.factory.createIdentifier(identifiers[0].name) as ts.Identifier, // name - import X from "module"
        undefined // named bindings
      );
    } else {
      const namedImport = ts.factory.createNamedImports(
        identifiers.map(this.createImportSpecifierWithOptionalAlias)
      );
      importClause = ts.factory.createImportClause(
        false, // is type only
        undefined, // name
        namedImport // named bindings - import { X, Y... } from "module"
      );
    }

    const importDeclaration = ts.factory.createImportDeclaration(
      undefined, // modifiers
      importClause,
      ts.factory.createStringLiteral(modulePath) // module specifier
    );

    return importDeclaration;
  }

  /**
   * Adds an import declaration to the source file.
   * @param identifiers The identifiers to import.
   * @param modulePath The path to import from.
   * @param isDefault Whether the import is a default import.
   * @remarks If `isDefault` is `true`, the first element of `identifiers` will be used and
   * the import will be a default import of the form `import MyClass from "my-module"`.
   */
  public addImportDeclaration(
    identifiers: IIdentifier[],
    modulePath: string,
    isDefault: boolean = false
  ): ts.SourceFile {
    const transformer: ts.TransformerFactory<ts.SourceFile> = (
      context: ts.TransformationContext
    ) => {
      return (file) => {
        let newStatements = [...file.statements];
        let importDeclarationUpdated = false;

        const allImportedIdentifiers =
          this.findImportedIdentifiers(newStatements);

        // filter identifiers that have not been imported from a different module or with the same alias
        const identifiersToImport = this.resolveIdentifiersToImport(
          identifiers,
          allImportedIdentifiers,
          modulePath
        );

        // loop over the statements to find and update the necessary import declaration
        for (let i = 0; i < newStatements.length; i++) {
          const statement = newStatements[i];
          if (
            ts.isImportDeclaration(statement) &&
            Util.trimQuotes(statement.moduleSpecifier.getText()) ===
              Util.trimQuotes(modulePath)
          ) {
            // if there are new identifiers to add to an existing import declaration, update it
            const namedBindings = statement.importClause?.namedBindings;
            if (
              namedBindings &&
              ts.isNamedImports(namedBindings) &&
              identifiersToImport.length > 0
            ) {
              importDeclarationUpdated = true;
              const updatedImportSpecifiers: ts.ImportSpecifier[] = [
                ...namedBindings.elements,
                ...identifiersToImport.map(
                  this.createImportSpecifierWithOptionalAlias
                ),
              ];
              const updatedNamedImports: ts.NamedImports =
                context.factory.updateNamedImports(
                  namedBindings,
                  updatedImportSpecifiers
                );
              const updatedImportClause: ts.ImportClause =
                context.factory.updateImportClause(
                  statement.importClause,
                  false,
                  statement.importClause.name,
                  updatedNamedImports
                );

              newStatements[i] = context.factory.updateImportDeclaration(
                statement,
                statement.modifiers,
                updatedImportClause,
                statement.moduleSpecifier,
                statement.attributes
              );
            }
            // exit the loop after modifying the existing import declaration
            break;
          }
        }

        // if no import declaration was updated and there are identifiers to add,
        // create a new import declaration with the identifiers
        if (
          !importDeclarationUpdated &&
          identifiers.length > 0 &&
          identifiersToImport.length > 0
        ) {
          const newImportDeclaration = this.createImportDeclaration(
            identifiers,
            modulePath,
            isDefault
          );
          newStatements = [
            ...file.statements.filter(ts.isImportDeclaration),
            newImportDeclaration,
            ...file.statements.filter((s) => !ts.isImportDeclaration(s)),
          ];
        }

        return ts.factory.updateSourceFile(file, newStatements);
      };
    };

    this.sourceFile = ts.transform(this.sourceFile, [
      transformer,
    ]).transformed[0];
    return this.flush();
  }

  /**
   * Parses the AST and return the resulting source code.
   * @remarks This method should be called after all modifications have been made to the AST.
   * If a formatter is provided, it will be used to format the source code.
   */
  public finalize(): string {
    if (this.formatter) {
      this.formatter.sourceFile = this.sourceFile;
      return this.formatter.applyFormatting();
    }

    return this.printer.printFile(this.sourceFile);
  }

  /**
   * Recreates the source file from the AST to make sure any added nodes have `pos` and `end` set.
   * @returns The recreated source file with updated positions for dynamically added nodes.
   */
  public flush(): ts.SourceFile {
    const content = this.printer.printFile(this.sourceFile);
    return (this.sourceFile = ts.createSourceFile(
      this.sourceFile.fileName,
      content,
      ts.ScriptTarget.Latest,
      true
    ));
  }

  /**
   * Gathers all imported identifiers from all import declarations.
   * @param statements The statements to search for import declarations.
   */
  private findImportedIdentifiers(
    statements: ts.Statement[]
  ): Map<string, IImport> {
    const allImportedIdentifiers = new Map<string, IImport>();
    for (const statement of statements) {
      if (ts.isImportDeclaration(statement)) {
        const namedBindings = statement.importClause?.namedBindings;
        if (namedBindings && ts.isNamedImports(namedBindings)) {
          for (const element of namedBindings.elements) {
            const identifier = element.propertyName
              ? element.propertyName.text
              : element.name.text;
            const alias = element.propertyName ? element.name.text : undefined;
            allImportedIdentifiers.set(identifier, {
              identifierName: identifier,
              moduleName: statement.moduleSpecifier.getText(),
              alias,
            });
          }
        }
      }
    }

    return allImportedIdentifiers;
  }

  /**
   * Resolves the identifiers to import based on the existing imports.
   * @param identifiers The identifiers to import.
   * @param allImportedIdentifiers The identifiers that have already been imported.
   * @param modulePath The path to import from.
   */
  private resolveIdentifiersToImport(
    identifiers: IIdentifier[],
    allImportedIdentifiers: Map<string, IImport>,
    modulePath: string
  ) {
    return identifiers.filter((identifier) => {
      const aliasCollides = Array.from(allImportedIdentifiers.values()).some(
        (existing) => existing.alias && existing.alias === identifier.alias
      );
      const importInfo = allImportedIdentifiers.get(identifier.name);
      const sameModule =
        importInfo &&
        Util.trimQuotes(importInfo.moduleName) === Util.trimQuotes(modulePath);
      const identifierNameCollides =
        importInfo && importInfo.identifierName === identifier.name;
      const identifierNameCollidesButDifferentAlias =
        identifierNameCollides && importInfo.alias !== identifier.alias;
      const identifierNameCollidesButDIfferentAliasAndModule =
        identifierNameCollidesButDifferentAlias && !sameModule;
      const isNewImport = !importInfo || sameModule;
      return (
        (!identifierNameCollides ||
          identifierNameCollidesButDifferentAlias ||
          identifierNameCollidesButDIfferentAliasAndModule) &&
        !aliasCollides &&
        isNewImport &&
        !sameModule
      );
    });
  }

  /**
   * Creates an import specifier with an optional alias.
   * @param identifier The identifier to import.
   */
  private createImportSpecifierWithOptionalAlias(
    identifier: IIdentifier
  ): ts.ImportSpecifier {
    // the last arg of `createImportSpecifier` is required - this is where the alias goes
    // the second arg is optional, this is where the name goes, hence the following
    const aliasOrName = identifier.alias || identifier.name;
    return ts.factory.createImportSpecifier(
      false, // is type only
      identifier.alias
        ? ts.factory.createIdentifier(identifier.name)
        : undefined,
      ts.factory.createIdentifier(aliasOrName)
    );
  }
}