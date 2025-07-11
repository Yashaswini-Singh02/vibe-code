import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('SmartContractCompiler');

export interface CompilationResult {
  success: boolean;
  bytecode?: string;
  abi?: any[];
  errors?: string[];
  warnings?: string[];
  gasEstimates?: any;
  metadata?: string;
}

export interface CompilerOptions {
  optimize?: boolean;
  optimizationRuns?: number;
  evmVersion?: string;
  outputSelection?: any;
}

export class SmartContractCompiler {
  private _solc: any = null;
  private _initialized = false;

  async initialize() {
    if (this._initialized) {
      return;
    }

    try {
      // dynamically import solc to avoid SSR issues
      const solcModule = await import('solc');
      this._solc = solcModule.default;
      this._initialized = true;
      logger.info('Solidity compiler initialized');
    } catch (error) {
      logger.error('Failed to initialize Solidity compiler:', error);
      throw new Error('Failed to initialize Solidity compiler');
    }
  }

  async compileSolidity(
    sourceCode: string,
    fileName: string = 'Contract.sol',
    options: CompilerOptions = {},
  ): Promise<CompilationResult> {
    await this.initialize();

    const defaultOptions = {
      optimize: options.optimize ?? false,
      optimizationRuns: options.optimizationRuns ?? 200,
      evmVersion: options.evmVersion ?? 'london',
      outputSelection: options.outputSelection ?? {
        '*': {
          '*': ['abi', 'evm.bytecode', 'evm.gasEstimates', 'metadata'],
        },
      },
    };

    const input = {
      language: 'Solidity',
      sources: {
        [fileName]: {
          content: sourceCode,
        },
      },
      settings: {
        optimizer: {
          enabled: defaultOptions.optimize,
          runs: defaultOptions.optimizationRuns,
        },
        evmVersion: defaultOptions.evmVersion,
        outputSelection: defaultOptions.outputSelection,
      },
    };

    try {
      const output = JSON.parse(this._solc.compile(JSON.stringify(input)));

      if (output.errors) {
        const errors = output.errors.filter((error: any) => error.severity === 'error');
        const warnings = output.errors.filter((error: any) => error.severity === 'warning');

        if (errors.length > 0) {
          return {
            success: false,
            errors: errors.map((error: any) => error.formattedMessage),
            warnings: warnings.map((warning: any) => warning.formattedMessage),
          };
        }
      }

      const contracts = output.contracts[fileName];

      if (!contracts) {
        return {
          success: false,
          errors: ['No contracts found in source code'],
        };
      }

      // get the first contract (assuming single contract files for now)
      const contractName = Object.keys(contracts)[0];
      const contract = contracts[contractName];

      return {
        success: true,
        bytecode: contract.evm?.bytecode?.object,
        abi: contract.abi,
        gasEstimates: contract.evm?.gasEstimates,
        metadata: contract.metadata,
        warnings:
          output.errors
            ?.filter((error: any) => error.severity === 'warning')
            .map((warning: any) => warning.formattedMessage) || [],
      };
    } catch (error) {
      logger.error('Compilation failed:', error);
      return {
        success: false,
        errors: [`Compilation failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  async compileRust(sourceCode: string, _fileName: string = 'lib.rs'): Promise<CompilationResult> {
    // for now, return a placeholder - rust compilation in browser is complex
    logger.warn('Rust compilation not yet implemented');
    return {
      success: false,
      errors: ['Rust compilation not yet implemented. Use shell actions with cargo build instead.'],
    };
  }

  async compileJavaScript(sourceCode: string, _fileName: string = 'contract.js'): Promise<CompilationResult> {
    try {
      // basic syntax validation for JavaScript contracts
      new Function(sourceCode);

      return {
        success: true,
        bytecode: sourceCode, // javaScript contracts don't have bytecode
        abi: [], // extract ABI from comments or exports if needed
        warnings: [],
      };
    } catch (error) {
      return {
        success: false,
        errors: [`JavaScript syntax error: ${error instanceof Error ? error.message : 'Unknown error'}`],
      };
    }
  }

  async compile(
    sourceCode: string,
    language: 'solidity' | 'rust' | 'javascript',
    fileName: string,
    options: CompilerOptions = {},
  ): Promise<CompilationResult> {
    switch (language) {
      case 'solidity': {
        return this.compileSolidity(sourceCode, fileName, options);
      }
      case 'rust': {
        return this.compileRust(sourceCode, fileName);
      }
      case 'javascript': {
        return this.compileJavaScript(sourceCode, fileName);
      }
      default: {
        return {
          success: false,
          errors: [`Unsupported language: ${language}`],
        };
      }
    }
  }
}

export const smartContractCompiler = new SmartContractCompiler();
