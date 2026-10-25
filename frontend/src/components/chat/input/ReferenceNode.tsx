import { useContext } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getNodeByKey,
  DecoratorNode,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';
import { ChatInputActionsContext } from './ChatInputActionsContext';
import { CodeReferenceChip, QuoteChip } from '../shared/ReferenceChip';

/** Also the prefix of the node's placeholder in the composer text. */
export type ReferenceKind = 'code-ref' | 'quote';

export type SerializedReferenceNode = Spread<{ id: string; kind: ReferenceKind }, SerializedLexicalNode>;

/** A code reference or a quote; its attachment holds the content. */
export class ReferenceNode extends DecoratorNode<JSX.Element> {
  __id: string;
  __kind: ReferenceKind;

  static getType(): string { return 'reference'; }
  static clone(node: ReferenceNode): ReferenceNode {
    return new ReferenceNode(node.__id, node.__kind, node.__key);
  }

  constructor(id: string, kind: ReferenceKind, key?: NodeKey) {
    super(key);
    this.__id = id;
    this.__kind = kind;
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.style.display = 'inline-block';
    return span;
  }

  updateDOM(): false { return false; }

  static importJSON(serializedNode: SerializedReferenceNode): ReferenceNode {
    return $createReferenceNode(serializedNode.id, serializedNode.kind);
  }

  exportJSON(): SerializedReferenceNode {
    return { id: this.__id, kind: this.__kind, type: 'reference', version: 1 };
  }

  getTextContent(): string {
    return `[${this.__kind}-${this.__id}]`;
  }

  decorate(): JSX.Element {
    return <ReferenceComponent id={this.__id} nodeKey={this.__key} />;
  }
}

export function $createReferenceNode(id: string, kind: ReferenceKind): ReferenceNode {
  return new ReferenceNode(id, kind);
}

export function $isReferenceNode(node: LexicalNode | null | undefined): node is ReferenceNode {
  return node instanceof ReferenceNode;
}

function ReferenceComponent({ id, nodeKey }: { id: string; nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const actions = useContext(ChatInputActionsContext);
  const attachment = actions?.attachments.find((item) => item.id === id);
  if (!attachment) return null;

  const onRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove();
    });
  };

  if (attachment.attachmentType === 'quote') {
    return <QuoteChip quote={attachment.quote ?? ''} onRemove={onRemove} />;
  }

  const { path = '', startLine, endLine } = attachment;
  return (
    <CodeReferenceChip
      fileName={attachment.name}
      path={path}
      startLine={startLine}
      endLine={endLine}
      onClick={() => actions?.onOpenFile?.(path, startLine ? startLine - 1 : undefined)}
      onRemove={onRemove}
    />
  );
}
