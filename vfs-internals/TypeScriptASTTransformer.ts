import ts from "typescript";
import { IFormattingService, IPropertyAssignment, IImport, IIdentifier } from "../types";

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
   * Checks if an import declaration's identifier or alias would collide with an existing one.
   * @param identifier The identifier to check for collisions.
   */
  public importDeclarationCollides(identifier: IIdentifier): boolean {
    const allImportedIdentifiers = this.findImportedIdentifiers([
      ...this.sourceFile.statements,
    ]);

    return Array.from(allImportedIdentifiers.values()).some(
      (importStatement) =>
        importStatement.identifierName === identifier.name ||
        importStatement.alias === identifier.alias
    );
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

        // loop over the statements to find and update the necessary import declaration
        for (let i = 0; i < newStatements.length; i++) {
          const statement = newStatements[i];
          if (
            ts.isImportDeclaration(statement) &&
            this.getModuleSpecifierName(statement.moduleSpecifier) ===
              modulePath
          ) {
            // if there are new identifiers to add to an existing import declaration, update it
            const namedBindings = statement.importClause?.namedBindings;
            if (
              namedBindings &&
              ts.isNamedImports(namedBindings) &&
              identifiers.length > 0
            ) {
              importDeclarationUpdated = true;
              const updatedImportSpecifiers: ts.ImportSpecifier[] = [
                ...namedBindings.elements,
                ...identifiers.map(this.createImportSpecifierWithOptionalAlias),
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
          identifiers.length > 0
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
            const identifierName = element.propertyName
              ? element.propertyName.text
              : element.name.text;
            const alias = element.propertyName ? element.name.text : undefined;
            allImportedIdentifiers.set(identifierName, {
              identifierName,
              moduleName: this.getModuleSpecifierName(
                statement.moduleSpecifier
              ),
              alias,
            });
          }
        }
      }
    }

    return allImportedIdentifiers;
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

  /**
   * Get a module specifier's node text representation.
   * @param moduleSpecifier the specifier to get the name of.
   * @remarks This method is used to get the name of a module specifier in an import declaration.
   *  It should always be a string literal.
   */
  private getModuleSpecifierName(moduleSpecifier: ts.Expression): string {
    if (ts.isStringLiteral(moduleSpecifier)) {
      return moduleSpecifier.text;
    }

    // a module specifier should always be a string literal, so this should never be reached
    throw new Error("Invalid module specifier.");
  }
}
