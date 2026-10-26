import { FormEvent, KeyboardEvent, useId, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { ElicitationAction, ElicitationContent, ElicitationProperty, ElicitationRequest, ElicitationValue } from '../../types/elicitation';
import { ACPBridge } from '../../utils/bridge';
import { buildElicitationContent, elicitationOptions, initialElicitationValues } from '../../utils/elicitation';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { RequestCard, RequestChoice, RequestHint } from './RequestCard';

const inputClassName = 'block h-8 w-full min-w-0 rounded-[4px] border border-border bg-background px-2 py-0 text-foreground placeholder:text-foreground-secondary focus:shadow-none focus:outline focus:outline-1 focus:outline-primary touch:h-10';
const buttonClassName = 'h-8 !py-0 focus:shadow-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary touch:h-10';

type Field = [string, ElicitationProperty];

function isFreeText(field: ElicitationProperty): boolean {
  return field.type === 'string' && !field.format && !elicitationOptions(field);
}

export function ElicitationForm({ request }: { request: ElicitationRequest }) {
  const id = useId();
  const schema = request.requestedSchema;
  const required = schema.required ?? [];
  const [values, setValues] = useState(() => initialElicitationValues(schema));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fields: Field[] = Object.entries(schema.properties);
  const last = fields[fields.length - 1];
  const heading = schema.title || fields[0]?.[1].title;
  const choiceFields = fields.filter(([, field]) => field.type === 'string' && !!elicitationOptions(field)?.length);
  // A single choice with nothing else to confirm is answered by clicking it; any other form waits for Send.
  const answersOnPick = choiceFields.length === 1
    && fields.every(([, field]) => field.type !== 'array' && field.type !== 'boolean');
  // An optional free-text answer fits beside the actions without assuming an adapter's field names.
  const inline = !!last && isFreeText(last[1]) && !required.includes(last[0]);
  const hasAnswer = Object.keys(buildElicitationContent(schema, values)).length > 0;
  const showSend = !answersOnPick || hasAnswer;

  const respond = async (action: ElicitationAction, answers = values) => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await ACPBridge.respondToElicitation(request, action, action === 'accept' ? buildElicitationContent(schema, answers) : undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const change = (key: string, value: ElicitationValue, byPointer: boolean) => {
    const next: ElicitationContent = { ...values, [key]: value };
    setValues(next);
    if (!byPointer || !answersOnPick || key !== choiceFields[0][0]) return;
    const content = buildElicitationContent(schema, next);
    if (required.every((name) => content[name] !== undefined)) void respond('accept', next);
  };

  // Arrow keys only select a choice; Enter then sends it, as in the text fields.
  const sendChoiceOnEnter = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || (event.target as HTMLInputElement).type !== 'radio') return;
    event.preventDefault();
    void respond('accept');
  };

  const renderField = ([key, field]: Field, index: number, footer = false) => {
    const compact = isFreeText(field) && !required.includes(key);
    const help = fieldRequirements(field);
    const labelHidden = compact || (field.title === heading && !field.description);
    // A choice group is a div, which a <label for> cannot target; it names itself through aria-labelledby instead.
    const Label = elicitationOptions(field) ? 'span' : 'label';
    return <div key={key} className={footer ? 'min-w-0 flex-[1_1_12rem]' : 'min-w-0 space-y-1'}>
      <div className="flex min-w-0 items-center gap-1.5">
        <Label id={`${id}-${index}-label`} htmlFor={Label === 'label' ? `${id}-${index}` : undefined}
          className={labelHidden ? 'sr-only' : `min-w-0 font-medium ${help ? 'truncate' : 'whitespace-pre-wrap'}`}>
          {field.description || field.title || key}
          {required.includes(key) && <span aria-label="required"> *</span>}
        </Label>
        {help && <RequestHint content={help} label={`${field.title || key} requirements`} />}
      </div>
      <ElicitationField id={`${id}-${index}`} field={field} value={values[key]} compact={compact}
        onSubmit={() => void respond('accept')} onChange={(value, byPointer = false) => change(key, value, byPointer)} />
    </div>;
  };

  return (
    <form noValidate aria-label={`${request.agentName} question`} aria-busy={submitting} onKeyDown={sendChoiceOnEnter}
      onSubmit={(event: FormEvent) => { event.preventDefault(); void respond('accept'); }}>
      <fieldset disabled={submitting} className="min-w-0">
        <RequestCard heading={heading} icon={<MessageCircleQuestion size={16} />}
          onDismiss={() => void respond('decline')} actions={(inline || showSend || error) ? <>
            {error && <p role="alert" className="w-full break-words text-error">{error}</p>}
            {inline && renderField(last, fields.length - 1, true)}
            {showSend && <Button type="submit" variant="primary" className={buttonClassName}>{submitting ? 'Sending…' : 'Send'}</Button>}
          </> : undefined}>
          {!heading && !fields.some(([, field]) => field.description) && <p>{request.message}</p>}
          {schema.description && schema.description !== heading && !fields.some(([, field]) => field.description === schema.description)
            && <p className="text-foreground-secondary">{schema.description}</p>}
          {(inline ? fields.slice(0, -1) : fields).map((entry, index) => renderField(entry, index))}
        </RequestCard>
      </fieldset>
    </form>
  );
}

function toggled(values: ElicitationValue | undefined, item: string): string[] {
  const previous = Array.isArray(values) ? values : [];
  return previous.includes(item) ? previous.filter((value) => value !== item) : [...previous, item];
}

function ElicitationField({ id, field, value, compact, onChange, onSubmit }: {
  id: string;
  field: ElicitationProperty;
  value: ElicitationValue | undefined;
  compact: boolean;
  onChange: (value: ElicitationValue, byPointer?: boolean) => void;
  onSubmit: () => void;
}) {
  const options = elicitationOptions(field);
  if (field.type === 'boolean') return <Checkbox id={id} checked={value === true} onCheckedChange={onChange} aria-labelledby={`${id}-label`} />;
  if (options) {
    const multiple = field.type === 'array';
    return <div id={id} role={multiple ? 'group' : 'radiogroup'} aria-labelledby={`${id}-label`}>
      {options.map((option) => <RequestChoice key={option.const} label={option.title} description={option.description} name={id}
        multiple={multiple} checked={multiple ? Array.isArray(value) && value.includes(option.const) : value === option.const}
        onSelect={(byPointer) => onChange(multiple ? toggled(value, option.const) : option.const, byPointer)} />)}
    </div>;
  }
  const type = field.type === 'number' || field.type === 'integer' ? 'number'
    : field.format === 'email' ? 'email' : field.format === 'uri' ? 'url' : field.format === 'date' ? 'date' : 'text';
  return <input id={id} type={type} value={typeof value === 'string' || typeof value === 'number' ? value : ''}
    className={inputClassName} step={field.type === 'integer' ? 1 : 'any'} min={field.minimum ?? undefined} max={field.maximum ?? undefined}
    placeholder={compact ? field.description || field.title || undefined : undefined}
    onKeyDown={(event) => {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
        event.preventDefault();
        onSubmit();
      }
    }}
    onChange={(event) => onChange(event.target.value)} />;
}

function fieldRequirements(field: ElicitationProperty): string {
  const requirements = [
    field.minLength != null ? `Minimum ${field.minLength} characters` : '',
    field.maxLength != null ? `Maximum ${field.maxLength} characters` : '',
    field.minimum != null ? `Minimum: ${field.minimum}` : '',
    field.maximum != null ? `Maximum: ${field.maximum}` : '',
    field.minItems != null ? `Select at least ${field.minItems}` : '',
    field.maxItems != null ? `Select at most ${field.maxItems}` : '',
    field.pattern != null ? `Pattern: ${field.pattern}` : '',
    field.format || '',
  ].filter(Boolean);
  return requirements.join(' · ');
}
