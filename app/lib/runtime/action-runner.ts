import { WebContainer } from '@webcontainer/api';
import { map, type MapStore } from 'nanostores';
import * as nodePath from 'node:path';
import type { BoltAction } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import type { ActionCallbackData } from './message-parser';
import type { TerminalStore } from '~/lib/stores/terminal';

const logger = createScopedLogger('ActionRunner');

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

export type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = BaseActionState | FailedActionState;

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed'>>;

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #terminalStore: TerminalStore;
  #currentExecutionPromise: Promise<void> = Promise.resolve();

  actions: ActionsMap = map({});

  constructor(webcontainerPromise: Promise<WebContainer>, terminalStore: TerminalStore) {
    this.#webcontainer = webcontainerPromise;
    this.#terminalStore = terminalStore;
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      // action already added
      return;
    }

    const abortController = new AbortController();

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.#updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    this.#currentExecutionPromise.then(() => {
      this.#updateAction(actionId, { status: 'running' });
    });
  }

  async runAction(data: ActionCallbackData) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return;
    }

    this.#updateAction(actionId, { ...action, ...data.action, executed: true });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId);
      })
      .catch((error) => {
        console.error('Action failed:', error);
      });
  }

  async #executeAction(actionId: string) {
    const action = this.actions.get()[actionId];

    this.#updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'shell': {
          await this.#runShellAction(action);
          break;
        }
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
        case 'contract': {
          await this.#runContractAction(action);
          break;
        }
      }

      this.#updateAction(actionId, { status: action.abortSignal.aborted ? 'aborted' : 'complete' });
    } catch (error) {
      this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });

      // re-throw the error to be caught in the promise chain
      throw error;
    }
  }

  async #runShellAction(action: ActionState) {
    if (action.type !== 'shell') {
      unreachable('Expected shell action');
    }

    const webcontainer = await this.#webcontainer;

    const process = await webcontainer.spawn('jsh', ['-c', action.content], {
      env: { npm_config_yes: true },
    });

    action.abortSignal.addEventListener('abort', () => {
      process.kill();
    });

    process.output.pipeTo(
      new WritableStream({
        write: (data) => {
          console.log(data);

          // write the output to all active terminals so users can see it
          this.#terminalStore.writeToTerminals(data);
        },
      }),
    );

    const exitCode = await process.exit;

    logger.debug(`Process terminated with code ${exitCode}`);
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const webcontainer = await this.#webcontainer;

    let folder = nodePath.dirname(action.filePath);

    // remove trailing slashes
    folder = folder.replace(/\/+$/g, '');

    if (folder !== '.') {
      try {
        await webcontainer.fs.mkdir(folder, { recursive: true });
        logger.debug('Created folder', folder);
      } catch (error) {
        logger.error('Failed to create folder\n\n', error);
      }
    }

    try {
      await webcontainer.fs.writeFile(action.filePath, action.content);
      logger.debug(`File written ${action.filePath}`);
    } catch (error) {
      logger.error('Failed to write file\n\n', error);
    }
  }

  async #runContractAction(action: ActionState) {
    if (action.type !== 'contract') {
      unreachable('Expected contract action');
    }

    try {
      // dynamically import the compiler to avoid SSR issues
      const { smartContractCompiler } = await import('~/lib/smartcontracts/compiler');

      const webcontainer = await this.#webcontainer;

      // read the source file
      const sourceCode = await webcontainer.fs.readFile(action.filePath, 'utf8');

      // compile the contract
      const result = await smartContractCompiler.compile(sourceCode, action.language, action.filePath, {
        optimize: action.optimize,
      });

      // create output directory
      const outputDir = action.outputDir || 'contracts/artifacts';
      const outputPath = nodePath.join(
        outputDir,
        nodePath.basename(action.filePath, nodePath.extname(action.filePath)),
      );

      try {
        await webcontainer.fs.mkdir(outputDir, { recursive: true });
      } catch {
        logger.debug('Output directory already exists or failed to create');
      }

      if (result.success) {
        // write compilation artifacts
        if (result.bytecode) {
          await webcontainer.fs.writeFile(`${outputPath}.bin`, result.bytecode);
        }

        if (result.abi) {
          await webcontainer.fs.writeFile(`${outputPath}.abi.json`, JSON.stringify(result.abi, null, 2));
        }

        if (result.metadata) {
          await webcontainer.fs.writeFile(`${outputPath}.metadata.json`, result.metadata);
        }

        // write compilation report
        const report = {
          success: true,
          fileName: action.filePath,
          language: action.language,
          target: action.target,
          warnings: result.warnings || [],
          gasEstimates: result.gasEstimates,
          compiledAt: new Date().toISOString(),
        };

        await webcontainer.fs.writeFile(`${outputPath}.report.json`, JSON.stringify(report, null, 2));

        logger.info(`Contract compiled successfully: ${action.filePath}`);
        console.log(`✅ Contract compilation successful!\n📁 Artifacts saved to: ${outputDir}`);

        if (result.warnings && result.warnings.length > 0) {
          console.log(`⚠️  Warnings:\n${result.warnings.join('\n')}`);
        }
      } else {
        // write error report
        const errorReport = {
          success: false,
          fileName: action.filePath,
          language: action.language,
          errors: result.errors || [],
          warnings: result.warnings || [],
          compiledAt: new Date().toISOString(),
        };

        await webcontainer.fs.writeFile(`${outputPath}.error.json`, JSON.stringify(errorReport, null, 2));

        logger.error(`Contract compilation failed: ${action.filePath}`);
        console.error(`❌ Contract compilation failed!\n${result.errors?.join('\n') || 'Unknown error'}`);

        if (result.warnings && result.warnings.length > 0) {
          console.log(`⚠️  Warnings:\n${result.warnings.join('\n')}`);
        }

        throw new Error('Compilation failed');
      }
    } catch (error) {
      logger.error('Contract action failed:', error);
      throw error;
    }
  }

  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }
}
