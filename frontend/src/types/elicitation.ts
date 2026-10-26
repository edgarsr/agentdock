export type ElicitationValue = string | number | boolean | string[];
export type ElicitationContent = Record<string, ElicitationValue>;
export type ElicitationAction = 'accept' | 'decline' | 'cancel';

export interface ElicitationOption {
  const: string;
  title: string;
  description?: string | null;
}

export interface ElicitationProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  title?: string | null;
  description?: string | null;
  default?: ElicitationValue | null;
  enum?: string[] | null;
  oneOf?: ElicitationOption[] | null;
  items?: { type?: 'string'; enum?: string[] | null; anyOf?: ElicitationOption[] | null } | null;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string | null;
  format?: 'email' | 'uri' | 'date' | 'date-time' | null;
  minimum?: number | null;
  maximum?: number | null;
  minItems?: number | null;
  maxItems?: number | null;
}

export interface ElicitationSchema {
  type: 'object';
  title?: string | null;
  description?: string | null;
  properties: Record<string, ElicitationProperty>;
  required?: string[] | null;
}

export interface ElicitationRequest {
  requestId: string;
  chatId: string;
  agentName: string;
  message: string;
  requestedSchema: ElicitationSchema;
  toolCallId?: string | null;
}
