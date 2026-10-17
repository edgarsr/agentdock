export interface CustomAcpEnvironmentVariable {
  name: string;
  value: string;
}

export interface CustomAcpCommand {
  name: string;
  description: string;
}

export interface CustomAcpConfig {
  id: string;
  name: string;
  command: string;
  enabled: boolean;
  args: string[];
  env: CustomAcpEnvironmentVariable[];
  cliCommand?: string;
  cliArgs: string[];
  cliResumeArgs: string[];
  commands?: CustomAcpCommand[];
}

export interface CustomAcpStatusUpdate {
  id: string;
  requestId: string;
  status: 'loading' | 'connected' | 'error';
  message?: string;
}
