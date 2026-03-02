import { } from 'react';

export function DesignSystemView() {
    return (
        <div className="h-full overflow-y-auto bg-background text-foreground p-6 space-y-8">
            {/* Colors */}
            <section className="space-y-4">
                <h2 className="text-sm font-bold opacity-40">COLORS</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    <ColorTile tw="bg-background" var="--ide-Panel-background" />
                    <ColorTile tw="bg-background-secondary" var="--ide-background-secondary" />
                    <ColorTile tw="bg-primary" var="--ide-Button-default-startBackground" />
                    <ColorTile tw="bg-secondary" var="--ide-Button-startBackground" />
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
                    <ColorTile tw="border-primary-border" var="--ide-Button-default-borderColor" />
                    <ColorTile tw="border-secondary-border" var="--ide-Button-borderColor" />
                </div>
            </section>

            {/* Syntax */}
            <section className="space-y-4">
                <h2 className="text-sm font-bold opacity-40">SYNTAX</h2>
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
                <h2 className="text-sm font-bold opacity-40">TYPOGRAPHY</h2>
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
                <h2 className="text-sm font-bold opacity-40">SPACING</h2>
                <div className="space-y-2">
                    <SpaceRow tw="space-y-ide-paragraph" var="--ide-paragraph-spacing" />
                    <SpaceRow tw="pl-ide-indent" var="--ide-list-indent" />
                </div>
            </section>

            {/* Border */}
            <section className="space-y-4">
                <h2 className="text-sm font-bold opacity-40">BORDER RADIUS</h2>
                <div className="flex items-center gap-3 p-3 bg-background-secondary border border-border">
                    <div className="w-16 h-16 bg-primary rounded-ide"></div>
                    <code className="text-xs">rounded-ide</code>
                    <code className="text-xs opacity-50">6px</code>
                </div>
            </section>
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
            <code className="text-xs block truncate opacity-40">{cssVar}</code>
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
            <code className="text-xs opacity-50">{cssVar}</code>
        </div>
    );
}
