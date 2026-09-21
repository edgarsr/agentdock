export interface CustomAcpEnvironmentVariable {
  name: string;
  value: string;
}

export interface CustomAcpConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: CustomAcpEnvironmentVariable[];
  cliCommand?: string;
  cliArgs: string[];
  cliResumeArgs: string[];
}
