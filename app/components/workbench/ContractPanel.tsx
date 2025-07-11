/* eslint-disable @typescript-eslint/no-unused-vars */
import { useStore } from '@nanostores/react';
import { memo, useState } from 'react';
import { PanelHeader } from '~/components/ui/PanelHeader';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { webcontainer } from '~/lib/webcontainer';

interface ContractPanelProps {
  className?: string;
}

interface CompilationJob {
  id: string;
  fileName: string;
  language: 'solidity' | 'rust' | 'javascript';
  status: 'pending' | 'compiling' | 'success' | 'error';
  errors?: string[];
  warnings?: string[];
  output?: string;
  artifacts?: {
    bytecode?: string;
    abi?: any[];
    gasEstimates?: any;
  };
}

export const ContractPanel = memo(({ className }: ContractPanelProps) => {
  const [compilationJobs, setCompilationJobs] = useState<CompilationJob[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<'solidity' | 'rust' | 'javascript'>('solidity');
  const [optimizeEnabled, setOptimizeEnabled] = useState(false);
  const selectedFile = useStore(workbenchStore.selectedFile);

  const handleCompileContract = async () => {
    if (!selectedFile) {
      alert('Please select a smart contract file to compile');
      return;
    }

    const fileExtension = selectedFile.split('.').pop()?.toLowerCase();
    let detectedLanguage: 'solidity' | 'rust' | 'javascript' = selectedLanguage;

    if (fileExtension === 'sol') {
      detectedLanguage = 'solidity';
    } else if (fileExtension === 'rs') {
      detectedLanguage = 'rust';
    } else if (fileExtension === 'js' || fileExtension === 'ts') {
      detectedLanguage = 'javascript';
    }

    const newJob: CompilationJob = {
      id: Date.now().toString(),
      fileName: selectedFile,
      language: detectedLanguage,
      status: 'pending',
    };

    setCompilationJobs((prev) => [newJob, ...prev]);

    try {
      await compileWithWebContainer(newJob.id, selectedFile, detectedLanguage, optimizeEnabled);
    } catch (error) {
      updateJobStatus(newJob.id, 'error', [`Compilation failed: ${error}`]);
    }
  };

  const compileWithWebContainer = async (
    jobId: string,
    filePath: string,
    language: 'solidity' | 'rust' | 'javascript',
    optimize: boolean,
  ) => {
    updateJobStatus(jobId, 'compiling');

    try {
      const container = await webcontainer;

      let output = '';
      let errors: string[] = [];
      let warnings: string[] = [];

      if (language === 'solidity') {
        // use the built-in solc compiler through a Node.js script with import resolution
        const compileScript = `
const fs = require('fs');
const path = require('path');
const solc = require('solc');

// Function to resolve imports - try to find dependencies in node_modules
function findImports(importPath) {
  try {
    // First try to find in node_modules
    if (importPath.startsWith('@openzeppelin/') || importPath.startsWith('@')) {
      const modulePath = path.join('node_modules', importPath);
      if (fs.existsSync(modulePath)) {
        return { contents: fs.readFileSync(modulePath, 'utf8') };
      }
    }
    
    // Try relative imports
    const relativePath = path.resolve(path.dirname('${filePath}'), importPath);
    if (fs.existsSync(relativePath)) {
      return { contents: fs.readFileSync(relativePath, 'utf8') };
    }
    
    // If not found, return error but continue compilation
    return { error: 'File not found: ' + importPath };
  } catch (error) {
    return { error: 'Import resolution failed: ' + error.message };
  }
}

try {
  const sourceCode = fs.readFileSync('${filePath}', 'utf8');
  
  const input = {
    language: 'Solidity',
    sources: {
      '${filePath}': {
        content: sourceCode
      }
    },
    settings: {
      optimizer: {
        enabled: ${optimize},
        runs: 200
      },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode', 'evm.gasEstimates', 'metadata']
        }
      }
    }
  };

  const result = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  
  if (result.errors) {
    const errors = result.errors.filter(error => error.severity === 'error');
    const warnings = result.errors.filter(error => error.severity === 'warning');
    
    if (errors.length > 0) {
      console.error('COMPILATION_ERRORS:', JSON.stringify(errors.map(e => e.formattedMessage)));
      process.exit(1);
    }
    
    if (warnings.length > 0) {
      console.warn('COMPILATION_WARNINGS:', JSON.stringify(warnings.map(w => w.formattedMessage)));
    }
  }

  const contracts = result.contracts['${filePath}'];
  if (contracts) {
    const contractName = Object.keys(contracts)[0];
    const contract = contracts[contractName];
    
    console.log('COMPILATION_SUCCESS:', JSON.stringify({
      bytecode: contract.evm?.bytecode?.object,
      abi: contract.abi,
      gasEstimates: contract.evm?.gasEstimates,
      metadata: contract.metadata
    }));
  } else {
    console.error('COMPILATION_ERRORS:', JSON.stringify(['No contracts found']));
    process.exit(1);
  }
} catch (error) {
  console.error('COMPILATION_ERRORS:', JSON.stringify([error.message]));
  process.exit(1);
}
        `;

        // write the compilation script to current working directory
        await container.fs.writeFile('compile-temp.js', compileScript);

        // execute the compilation
        const process = await container.spawn('node', ['compile-temp.js'], {
          env: { npm_config_yes: true },
        });

        const chunks: string[] = [];
        const errorChunks: string[] = [];

        process.output.pipeTo(
          new WritableStream({
            write: (data) => {
              chunks.push(data);
            },
          }),
        );

        const exitCode = await process.exit;

        output = chunks.join('');

        // check if the error is due to missing OpenZeppelin contracts
        if (exitCode !== 0 && output.includes('@openzeppelin/contracts')) {
          console.log('Installing OpenZeppelin contracts...');

          try {
            // install OpenZeppelin contracts
            const installProcess = await container.spawn('npm', ['install', '@openzeppelin/contracts'], {
              env: { npm_config_yes: true },
            });

            await installProcess.exit;

            // retry compilation after installing dependencies
            const retryProcess = await container.spawn('node', ['compile-temp.js'], {
              env: { npm_config_yes: true },
            });

            const retryChunks: string[] = [];
            retryProcess.output.pipeTo(
              new WritableStream({
                write: (data) => {
                  retryChunks.push(data);
                },
              }),
            );

            const retryExitCode = await retryProcess.exit;
            output = retryChunks.join('');

            if (retryExitCode === 0) {
              // parse successful compilation output
              const successMatch = output.match(/COMPILATION_SUCCESS: (.+)/);

              if (successMatch) {
                const artifacts = JSON.parse(successMatch[1]);
                updateJobStatus(jobId, 'success', undefined, artifacts);

                return;
              }
            } else {
              // still failed after installing dependencies
              const errorMatch = output.match(/COMPILATION_ERRORS: (.+)/);

              if (errorMatch) {
                errors = JSON.parse(errorMatch[1]);
              } else {
                errors = ['Compilation failed even after installing dependencies'];
              }

              updateJobStatus(jobId, 'error', errors);

              return;
            }
          } catch (installError) {
            updateJobStatus(jobId, 'error', [
              `Failed to install dependencies: ${installError instanceof Error ? installError.message : 'Unknown error'}`,
            ]);
            return;
          }
        }

        if (exitCode === 0) {
          // parse successful compilation output
          const successMatch = output.match(/COMPILATION_SUCCESS: (.+)/);
          const warningsMatch = output.match(/COMPILATION_WARNINGS: (.+)/);

          if (successMatch) {
            const artifacts = JSON.parse(successMatch[1]);
            updateJobStatus(jobId, 'success', undefined, artifacts);
          }

          if (warningsMatch) {
            warnings = JSON.parse(warningsMatch[1]);
          }
        } else {
          // parse error output
          const errorMatch = output.match(/COMPILATION_ERRORS: (.+)/);

          if (errorMatch) {
            errors = JSON.parse(errorMatch[1]);
          } else {
            errors = ['Unknown compilation error'];
          }

          updateJobStatus(jobId, 'error', errors);
        }

        // clean up temporary compilation script
        try {
          await container.fs.rm('compile-temp.js');
        } catch (error) {
          // ignore cleanup errors
        }
      } else if (language === 'rust') {
        // for Rust, use cargo build
        const process = await container.spawn('cargo', ['build', '--manifest-path', filePath], {
          env: { npm_config_yes: true },
        });

        const chunks: string[] = [];
        process.output.pipeTo(
          new WritableStream({
            write: (data) => {
              chunks.push(data);
            },
          }),
        );

        const exitCode = await process.exit;
        output = chunks.join('');

        if (exitCode === 0) {
          updateJobStatus(jobId, 'success', undefined, {
            bytecode: 'Rust compilation successful',
            abi: [],
            gasEstimates: {},
          });
        } else {
          updateJobStatus(jobId, 'error', [output || 'Rust compilation failed']);
        }
      } else if (language === 'javascript') {
        // for JavaScript, just validate syntax
        try {
          const container = await webcontainer;
          const sourceCode = await container.fs.readFile(filePath, 'utf8');

          // basic syntax validation
          new Function(sourceCode);

          updateJobStatus(jobId, 'success', undefined, {
            bytecode: 'JavaScript validation successful',
            abi: [],
            gasEstimates: {},
          });
        } catch (error) {
          updateJobStatus(jobId, 'error', [
            `JavaScript syntax error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ]);
        }
      }
    } catch (error) {
      updateJobStatus(jobId, 'error', [
        `Compilation setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ]);
    }
  };

  const updateJobStatus = (
    jobId: string,
    status: CompilationJob['status'],
    errors?: string[],
    artifacts?: CompilationJob['artifacts'],
    output?: string,
  ) => {
    setCompilationJobs((prev) =>
      prev.map((job) => (job.id === jobId ? { ...job, status, errors, artifacts, output } : job)),
    );
  };

  const getStatusIcon = (status: CompilationJob['status']) => {
    switch (status) {
      case 'pending': {
        return 'i-ph:clock-duotone';
      }
      case 'compiling': {
        return 'i-svg-spinners:90-ring-with-bg';
      }
      case 'success': {
        return 'i-ph:check-circle-duotone';
      }
      case 'error': {
        return 'i-ph:x-circle-duotone';
      }
      default: {
        return 'i-ph:question-duotone';
      }
    }
  };

  const getStatusColor = (status: CompilationJob['status']) => {
    switch (status) {
      case 'pending': {
        return 'text-bolt-elements-textSecondary';
      }
      case 'compiling': {
        return 'text-blue-500';
      }
      case 'success': {
        return 'text-green-500';
      }
      case 'error': {
        return 'text-red-500';
      }
      default: {
        return 'text-bolt-elements-textSecondary';
      }
    }
  };

  return (
    <div className={classNames('flex flex-col h-full', className)}>
      <PanelHeader>
        <div className="i-ph:code-block-duotone shrink-0" />
        Smart Contracts
      </PanelHeader>

      <div className="flex-1 p-4 overflow-auto">
        {/* Compilation Controls */}
        <div className="mb-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-bolt-elements-textPrimary mb-2">Language</label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value as any)}
              className="w-full p-2 bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor rounded-md text-bolt-elements-textPrimary"
            >
              <option value="solidity">Solidity</option>
              <option value="rust">Rust</option>
              <option value="javascript">JavaScript</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="optimize"
              checked={optimizeEnabled}
              onChange={(e) => setOptimizeEnabled(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="optimize" className="text-sm text-bolt-elements-textPrimary">
              Enable optimization
            </label>
          </div>

          <button
            onClick={handleCompileContract}
            disabled={!selectedFile}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-2 px-4 rounded-md font-medium transition-colors"
          >
            Compile Contract
          </button>
        </div>

        {/* Compilation Jobs */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-bolt-elements-textPrimary">Recent Compilations</h3>

          {compilationJobs.length === 0 ? (
            <div className="text-center py-8 text-bolt-elements-textSecondary">
              <div className="i-ph:code-block text-4xl mb-2" />
              <p>No contracts compiled yet</p>
            </div>
          ) : (
            compilationJobs.map((job) => (
              <div key={job.id} className="border border-bolt-elements-borderColor rounded-md p-3">
                <div className="flex items-start gap-3">
                  <div className={classNames('mt-0.5', getStatusIcon(job.status), getStatusColor(job.status))} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-bolt-elements-textPrimary truncate">{job.fileName}</span>
                      <span className="text-xs bg-bolt-elements-background-depth-2 px-2 py-0.5 rounded">
                        {job.language}
                      </span>
                    </div>

                    <div className="text-sm text-bolt-elements-textSecondary capitalize">
                      {job.status === 'compiling' ? 'Compiling...' : job.status}
                    </div>

                    {job.errors && job.errors.length > 0 && (
                      <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                        {job.errors.map((error, index) => (
                          <div key={index} className="font-mono text-xs whitespace-pre-wrap">
                            {error}
                          </div>
                        ))}
                      </div>
                    )}

                    {job.warnings && job.warnings.length > 0 && (
                      <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
                        {job.warnings.map((warning, index) => (
                          <div key={index} className="font-mono text-xs whitespace-pre-wrap">
                            {warning}
                          </div>
                        ))}
                      </div>
                    )}

                    {job.status === 'success' && job.artifacts && (
                      <div className="mt-2 space-y-2">
                        <div className="text-xs text-bolt-elements-textSecondary">
                          <div>✓ Compilation completed successfully</div>
                          {job.artifacts.abi && <div>✓ ABI generated</div>}
                          {job.artifacts.gasEstimates && <div>✓ Gas estimates calculated</div>}
                        </div>

                        {job.artifacts.bytecode &&
                          job.artifacts.bytecode !== 'Compilation completed successfully' &&
                          job.artifacts.bytecode !== 'Rust compilation successful' &&
                          job.artifacts.bytecode !== 'JavaScript validation successful' && (
                            <div className="mt-2">
                              <div className="text-xs font-medium text-bolt-elements-textPrimary mb-1">Bytecode:</div>
                              <div className="bg-bolt-elements-background-depth-2 p-2 rounded  text-white text-xs font-mono break-all">
                                {job.artifacts.bytecode.slice(0, 100)}
                                {job.artifacts.bytecode.length > 100 && '...'}
                              </div>
                            </div>
                          )}

                        {job.artifacts.abi && job.artifacts.abi.length > 0 && (
                          <div className="mt-2">
                            <div className="text-xs font-medium text-bolt-elements-textPrimary mb-1">ABI:</div>
                            <div className="bg-bolt-elements-background-depth-2 p-2 rounded text-white text-xs font-mono max-h-32 overflow-y-auto">
                              {JSON.stringify(job.artifacts.abi, null, 2)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

ContractPanel.displayName = 'ContractPanel';
