import { useState } from 'react';

import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { DropdownSelect } from './ui/DropdownSelect';
import { SplitButton } from './ui/SplitButton';

export function DesignSystemView() {
    const [reloadInBrowser, setReloadInBrowser] = useState('on-save');
    const [reloadInPreview, setReloadInPreview] = useState('on-save');
    const [mercurialEnabled, setMercurialEnabled] = useState(false);
    const [themeEnabled, setThemeEnabled] = useState(true);
    const reloadOptions = [
        { value: 'disabled', label: 'Disabled' },
        { value: 'on-save', label: 'On Save' },
        { value: 'on-change', label: 'On Change' },
    ];

    return (
        <div className="h-full overflow-y-auto bg-background text-foreground">
            <div className="max-w-[1200px] mx-auto w-full p-6 space-y-8">
            {/* Colors */}
            <section className="space-y-4">
                <h2 className="text-sm font-bold text-foreground-secondary">COLORS</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    <ColorTile tw="bg-background" var="--ide-Panel-background" />
                    <ColorTile tw="bg-background-secondary" var="--ide-background-secondary" />
                    <ColorTile tw="bg-primary" var="--ide-Button-default-startBackground" />
                    <ColorTile tw="bg-secondary" var="--ide-Button-startBackground" />
                    <ColorTile tw="bg-[...default-end]" var="--ide-Button-default-endBackground" />
                    <ColorTile tw="bg-[...secondary-end]" var="--ide-Button-endBackground" />
                    <ColorTile tw="bg-accent" var="--ide-List-selectionBackground" />
                    <ColorTile tw="bg-input" var="--ide-TextField-background" />
                    <ColorTile tw="bg-editor-bg" var="--ide-editor-bg" />

                    <ColorTile tw="text-foreground" var="--ide-Label-foreground" isText />
                    <ColorTile tw="text-foreground-secondary" var="--ide-Label-disabledForeground" isText />
                    <ColorTile tw="text-primary-foreground" var="--ide-Button-default-foreground" isText />
                    <ColorTile tw="text-secondary-foreground" var="--ide-Button-foreground" isText />
                    <ColorTile tw="text-accent-foreground" var="--ide-List-selectionForeground" isText />
                    <ColorTile tw="text-editor-fg" var="--ide-editor-fg" isText />
                    <ColorTile tw="text-success" var="#57965c" isText />
                    <ColorTile tw="text-error" var="#db5c5c" isText />
                    <ColorTile tw="text-warning" var="#ba9752" isText />
                    <ColorTile tw="text-link" var="--ide-Hyperlink-linkColor" isText />
                    <ColorTile tw="text-added" var="--ide-vcs-added" isText />
                    <ColorTile tw="text-deleted" var="--ide-vcs-deleted" isText />

                    <ColorTile tw="border-border" var="--ide-Borders-color" />
                    <ColorTile tw="border-[...contrast]" var="--ide-Borders-ContrastBorderColor" />
                    <ColorTile tw="border-primary-border" var="--ide-Button-default-borderColor" />
                    <ColorTile tw="border-secondary-border" var="--ide-Button-borderColor" />
                    <ColorTile tw="border-focus" var="--ide-Button-focusedBorderColor" />
                    <ColorTile tw="border-default-focus" var="--ide-Button-default-focusedBorderColor" />
                    <ColorTile tw="text-default-focus" var="--ide-Button-default-focusColor" isText />
                </div>
            </section>

            {/* Syntax */}
            <section className="space-y-4">
                <h2 className="text-sm font-bold text-foreground-secondary">SYNTAX</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <ColorTile tw="text-syntax-keyword" var="--ide-syntax-keyword" isText />
                    <ColorTile tw="text-syntax-string" var="--ide-syntax-string" isText />
                    <ColorTile tw="text-syntax-number" var="--ide-syntax-number" isText />
                    <ColorTile tw="text-syntax-comment" var="--ide-syntax-comment" isText />
                    <ColorTile tw="text-syntax-function" var="--ide-syntax-function" isText />
                    <ColorTile tw="text-syntax-class" var="--ide-syntax-class" isText />
                    <ColorTile tw="text-syntax-tag" var="--ide-syntax-tag" isText />
                    <ColorTile tw="text-syntax-attr" var="--ide-syntax-attr" isText />
                </div>
            </section>

            {/* Typography */}
            <section className="space-y-4">
                <h2 className="text-sm font-bold text-foreground-secondary">TYPOGRAPHY</h2>
                <div className="space-y-2">
                    <TypeRow tw="text-ide-h1" sample="Heading 1" />
                    <TypeRow tw="text-ide-h2" sample="Heading 2" />
                    <TypeRow tw="text-ide-h3" sample="Heading 3" />
                    <TypeRow tw="text-ide-h4" sample="Heading 4" />
                    <TypeRow tw="text-ide-regular" sample="Regular" />
                    <TypeRow tw="text-ide-medium" sample="Medium" />
                    <TypeRow tw="text-ide-small" sample="Small" />
                </div>
            </section>

            {/* Spacing */}
            <section className="space-y-4">
                <h2 className="text-sm font-bold text-foreground-secondary">SPACING</h2>
                <div className="space-y-2">
                    <SpaceRow tw="space-y-ide-paragraph" var="--ide-paragraph-spacing" />
                    <SpaceRow tw="pl-ide-indent" var="--ide-list-indent" />
                </div>
            </section>

            {/* Border */}
            <section className="space-y-4">
                <h2 className="text-sm font-bold text-foreground-secondary">BORDER RADIUS</h2>
                <div className="flex items-center gap-3 p-3 bg-background-secondary border border-border">
                    <div className="w-16 h-16 bg-primary rounded-ide"></div>
                    <code className="text-xs">rounded-ide</code>
                    <code className="text-xs text-foreground-secondary">6px</code>
                </div>
            </section>

            {/* Buttons */}
            <section className="space-y-4">
                <h2 className="text-sm font-bold text-foreground-secondary">BUTTONS</h2>
                <div className="space-y-4 rounded-[10px] border border-border bg-background px-5 py-5">
                    <div className="flex flex-wrap items-center gap-4">
                        <Button variant="primary">OK</Button>
                        <Button variant="secondary">Cancel</Button>
                        <Button variant="secondary" disabled>Apply</Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                        <Button variant="install">Install</Button>
                        <Button variant="accentOutline">Uninstall</Button>
                        <SplitButton label="Update" menuItems={[{ label: 'Uninstall' }]} />
                    </div>
                </div>
            </section>

            <section className="space-y-4">
                <h2 className="text-sm font-bold text-foreground-secondary">DROPDOWNS</h2>
                <div className="flex flex-wrap items-start gap-4 rounded-[10px] border border-border bg-background px-5 py-5">
                    <DropdownSelect
                        value={reloadInBrowser}
                        options={reloadOptions}
                        onChange={setReloadInBrowser}
                    />
                    <DropdownSelect
                        value={reloadInPreview}
                        options={reloadOptions}
                        onChange={setReloadInPreview}
                    />
                </div>
            </section>

            <section className="space-y-4">
                <h2 className="text-sm font-bold text-foreground-secondary">CHECKBOXES</h2>
                <div className="overflow-hidden rounded-[10px] border border-border bg-background">
                    <CheckboxRow
                        title="Mercurial"
                        subtitle="261.22158.185  JetBrains"
                        checked={mercurialEnabled}
                        onCheckedChange={setMercurialEnabled}
                    />
                    <CheckboxRow
                        title="One Dark Theme"
                        subtitle="6.2.2  Mark Skelton"
                        checked={themeEnabled}
                        onCheckedChange={setThemeEnabled}
                    />
                </div>
            </section>
            </div>
        </div>
    );
}

function CheckboxRow({
    title,
    subtitle,
    checked,
    onCheckedChange,
}: {
    title: string;
    subtitle: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
            <div className="min-w-0">
                <div className="truncate text-foreground">{title}</div>
                <div className="truncate text-foreground-secondary">{subtitle}</div>
            </div>
            <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    );
}


function ColorTile({ tw, var: cssVar, isText }: { tw: string; var: string; isText?: boolean }) {
    const colorValue = cssVar.startsWith('#') ? cssVar : `var(${cssVar})`;
    return (
        <div className="p-3 bg-background-secondary border border-border space-y-2">
            <div
                className="w-full h-20 border border-border"
                style={{
                    [isText ? 'color' : 'backgroundColor']: colorValue,
                    ...(isText && { backgroundColor: 'var(--ide-Panel-background)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', fontWeight: 'bold' })
                }}
            >
                {isText && 'Aa'}
            </div>
            <code className="text-xs block truncate">{tw}</code>
            <code className="text-xs block truncate text-foreground-secondary">{cssVar}</code>
        </div>
    );
}

function TypeRow({ tw, sample }: { tw: string; sample: string }) {
    return (
        <div className="flex items-baseline gap-3 p-2 bg-background-secondary border border-border">
            <code className="text-xs w-32 flex-shrink-0">{tw}</code>
            <span className={tw}>{sample}</span>
        </div>
    );
}

function SpaceRow({ tw, var: cssVar }: { tw: string; var: string }) {
    return (
        <div className="flex items-center gap-3 p-2 bg-background-secondary border border-border">
            <code className="text-xs w-40 flex-shrink-0">{tw}</code>
            <code className="text-xs text-foreground-secondary">{cssVar}</code>
        </div>
    );
}
