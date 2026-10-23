import * as React from 'react';
import type { GroupBlock, SmartUILeafBlock } from '../shared/types.js';
import { BlockView } from './components.js';
import { useEnvironment } from './environment.js';

export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count < 1) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight') return (current + 1) % count;
  if (key === 'ArrowLeft') return (current - 1 + count) % count;
  return null;
}

export function GroupView({ block, blocks, callId, disabled, onFill }: {
  block: GroupBlock; blocks: readonly SmartUILeafBlock[];
  callId: string; disabled: boolean; onFill: (text: string) => void;
}) {
  const { t } = useEnvironment();
  const prefix = React.useId();
  const [selected, setSelected] = React.useState(blocks[0]?.id);
  const tabs = React.useRef<HTMLDivElement>(null);
  const activeId = blocks.some(child => child.id === selected) ? selected : blocks[0]?.id;
  const title = block.title ?? t('type.group');
  const renderBlock = (child: SmartUILeafBlock) => <BlockView block={child} callId={callId} disabled={disabled} onFill={onFill} />;
  return <section className={`smartui-group smartui-group-${block.layout}`} aria-labelledby={`${prefix}-title`}>
    <h3 className="smartui-group-title" id={`${prefix}-title`}>{title}</h3>
    {block.layout === 'tabs' ? <>
      <div className="smartui-tablist" role="tablist" aria-label={title} ref={tabs}>
        {blocks.map((child, index) => <button key={child.id} type="button" role="tab" id={`${prefix}-tab-${child.id}`}
          aria-controls={`${prefix}-panel-${child.id}`} aria-selected={child.id === activeId} tabIndex={child.id === activeId ? 0 : -1}
          onClick={() => setSelected(child.id)} onKeyDown={event => {
            const next = nextTabIndex(event.key, index, blocks.length);
            if (next === null) return;
            event.preventDefault();
            setSelected(blocks[next]?.id);
            tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}>{child.title ?? t(`type.${child.type}`)}</button>)}
      </div>
      {/* Keep all panels mounted: switching tabs must not discard a form, filter or choice. */}
      {blocks.map(child => <div key={child.id} role="tabpanel" id={`${prefix}-panel-${child.id}`}
        aria-labelledby={`${prefix}-tab-${child.id}`} hidden={child.id !== activeId} tabIndex={0}>{renderBlock(child)}</div>)}
    </> : <div className="smartui-group-content">{blocks.map(child => <React.Fragment key={child.id}>{renderBlock(child)}</React.Fragment>)}</div>}
  </section>;
}
