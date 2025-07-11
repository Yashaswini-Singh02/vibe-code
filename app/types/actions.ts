export type ActionType = 'file' | 'shell' | 'contract';

export interface BaseAction {
  content: string;
}

export interface FileAction extends BaseAction {
  type: 'file';
  filePath: string;
}

export interface ShellAction extends BaseAction {
  type: 'shell';
}

export interface ContractAction extends BaseAction {
  type: 'contract';
  language: 'solidity' | 'rust' | 'javascript';
  filePath: string;
  target?: 'ethereum' | 'polygon' | 'bsc' | 'solana' | 'near';
  optimize?: boolean;
  outputDir?: string;
}

export type BoltAction = FileAction | ShellAction | ContractAction;

export type BoltActionData = BoltAction | BaseAction;
