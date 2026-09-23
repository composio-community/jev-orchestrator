// Inspector panel for a source node: connect the accounts it needs, fill in its settings, switch it on.
import { useState } from 'react';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ItemRec } from '@/store';
import { actions } from '@/store';
import type { Snapshot, SourceId } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Empty, RecentList } from './Recent';

const TRIGGER_PREFIX: Record<SourceId, string> = { gmail: 'GMAIL', typeform: 'TYPEFORM', slack: 'SLACK', discord: 'DISCORD', x: 'TWITTER' };

export function SourcePanel({ id, snap, recent }: { id: SourceId; snap: Snapshot; recent: ItemRec[] }) {
  const meta = snap.sources?.[id];
  const src = snap.config.sources[id];
  const accounts = snap.stats.accounts ?? {};
  const pending = snap.stats.pending ?? {};
  const checked = !!snap.stats.accounts && !snap.stats.accountsError; // the account check has completed
  if (!meta || !src) return <Empty>Unknown source</Empty>;
  // Presenting: no connect buttons, credential forms, trigger ids or "not connected" anywhere on screen.
  if (snap.stats.demo?.running) {
    return (
      <div className="space-y-5">
        <Section title="Watching">
          <div className="rounded-lg border bg-card px-3 py-2.5 text-xs">
            <div className="flex items-center gap-2 font-medium"><span className="size-1.5 rounded-full bg-[var(--grass-9)]" />On</div>
            <p className="mt-1 text-muted-foreground">{meta.kind === 'poll' ? 'Mentions are polled every few minutes.' : 'New messages are pushed here as they arrive.'}</p>
          </div>
        </Section>
        <Section title="Recent"><RecentList items={recent} /></Section>
      </div>
    );
  }
  const needed = [...meta.toolkits, ...(id === 'discord' && src.replyVia === 'bot' ? meta.optional : [])];
  const allConnected = needed.every((t) => accounts[t]);
  const missing = meta.fields.filter((f) => f.required && !String(src[f.key as keyof typeof src] ?? '').trim());
  const needsApp = id === 'x' && !src.authConfigId;
  const canEnable = allConnected && !missing.length && !needsApp;
  const triggers = (snap.stats.triggers ?? []).filter((t) => t.name.startsWith(TRIGGER_PREFIX[id]));

  return (
    <div className="space-y-5">
      <Section title="Watching">
        <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
          <div className="min-w-0 flex-1 text-xs">
            <div className="font-medium">{src.enabled ? 'On' : 'Off'}</div>
            <div className="text-muted-foreground">
              {src.enabled
                ? meta.kind === 'poll' ? `Polling mentions of @${src.handle} every ${src.pollMinutes ?? 5} min` : 'Composio pushes new messages to this process'
                : !allConnected ? 'Connect the account' + (meta.toolkits.length > 1 ? 's' : '') + ' below first'
                : needsApp ? 'Save your X app first'
                : missing.length ? `Fill in ${missing.map((f) => f.label).join(', ')} first`
                : 'Ready to switch on'}
            </div>
          </div>
          <EnableSwitch id={id} enabled={src.enabled} disabled={!src.enabled && !canEnable} />
        </div>
      </Section>

      <Section title={meta.toolkits.length > 1 ? 'Accounts' : 'Account'}>
        {needsApp && <XAppForm fromEnv={!!snap.xAppInEnv} />}
        <ul className="divide-y rounded-lg border bg-card">
          {[...meta.toolkits, ...meta.optional].map((t) => (
            <ToolkitRow key={t} toolkit={t} label={meta.toolkitLabels[t] ?? t} connected={!!accounts[t]} pending={!!pending[t]} checking={!checked} disabled={t === 'twitter' && needsApp} optional={meta.optional.includes(t) && !needed.includes(t)} />
          ))}
        </ul>
        {snap.stats.accountsError && <p className="text-[11px] text-destructive">{snap.stats.accountsError}</p>}
      </Section>

      {id === 'x' && src.selfHandle && src.handle && src.selfHandle.toLowerCase() !== src.handle.toLowerCase() && (
        <div className="rounded-lg border border-[var(--amber-7)] bg-[var(--amber-3)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--amber-11)]">
          Replies are posted from <b>@{src.selfHandle}</b>, but mentions of <b>@{src.handle}</b> are what is being watched. Someone who writes to @{src.handle} would be answered by a different account. Set the handle to @{src.selfHandle}, or connect @{src.handle} instead.
        </div>
      )}
      {meta.fields.length > 0 && (
        <Section title="Settings">
          <FieldsForm id={id} fields={meta.fields} initial={Object.fromEntries(meta.fields.map((f) => [f.key, f.list ? ((src[f.key as keyof typeof src] as string[] | undefined) ?? []).join(', ') : String(src[f.key as keyof typeof src] ?? '')]))} />
        </Section>
      )}

      <Section title="Triggers">
        {triggers.length ? (
          <ul className="divide-y rounded-lg border bg-card">
            {triggers.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1"><div className="truncate font-mono text-[11px]">{t.name}</div><div className="truncate font-mono text-[10px] text-muted-foreground">{t.id}</div></div>
                <Switch checked={!t.disabled} onCheckedChange={(on) => void actions.setTrigger(t.id, on)} />
              </li>
            ))}
          </ul>
        ) : <Empty>{meta.kind === 'poll' ? 'Polled, no trigger' : 'No trigger yet. Switch the source on to create one.'}</Empty>}
      </Section>

      <Section title="Recent"><RecentList items={recent} /></Section>
    </div>
  );
}

function EnableSwitch({ id, enabled, disabled }: { id: SourceId; enabled: boolean; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {error && <span className="max-w-40 truncate text-[11px] text-destructive" title={error}>{error}</span>}
      {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : (
        <Switch checked={enabled} disabled={disabled} onCheckedChange={async (on) => { setBusy(true); setError(await actions.setSource(id, { enabled: on })); setBusy(false); }} />
      )}
    </div>
  );
}

function ToolkitRow({ toolkit, label, connected, pending, checking, disabled, optional }: { toolkit: string; label: string; connected: boolean; pending: boolean; checking: boolean; disabled: boolean; optional?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span className={cn('size-1.5 shrink-0 rounded-full', connected ? 'bg-[var(--grass-9)]' : pending || checking ? 'bg-[var(--amber-9)] animate-pulse' : 'bg-muted-foreground/40')} />
      <div className="min-w-0 flex-1 text-xs">
        <div className="truncate">{label}</div>
        <div className="truncate text-[11px] text-muted-foreground">{connected ? 'Connected' : checking ? 'Checking…' : pending ? 'Waiting for you to finish signing in…' : optional ? 'Not needed unless the bot should post replies' : 'Not connected'}</div>
      </div>
      {connected ? (
        <div className="flex items-center gap-1.5">
          <Check className="size-4 text-[var(--grass-11)]" />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Disconnect ${label}? Anything using it stops watching until you connect an account again.`)) return;
              setBusy(true);
              await actions.disconnect(toolkit);
              setBusy(false);
            }}
          >
            Disconnect
          </Button>
        </div>
      ) : checking ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : (
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={disabled || busy} onClick={async () => { setBusy(true); await actions.connect(toolkit); setBusy(false); }}>
          {pending ? 'Open again' : 'Connect'}<ExternalLink className="size-3 opacity-60" />
        </Button>
      )}
    </li>
  );
}

function FieldsForm({ id, fields, initial }: { id: SourceId; fields: Snapshot['sources'][SourceId]['fields']; initial: Record<string, string> }) {
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = fields.some((f) => values[f.key] !== initial[f.key]);
  return (
    <div className="space-y-3 rounded-lg border bg-card px-3 py-3">
      {fields.map((f) => (
        <label key={f.key} className="block space-y-1 text-xs">
          <span className="font-medium">{f.label}{f.required && <span className="text-muted-foreground"> · required</span>}</span>
          {f.options ? (
            <Select value={values[f.key] || f.options[0].value} onValueChange={(v) => { setValues({ ...values, [f.key]: v }); setSaved(false); }}>
              <SelectTrigger size="sm" className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{f.options.map((o) => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Input value={values[f.key] ?? ''} onChange={(e) => { setValues({ ...values, [f.key]: e.target.value }); setSaved(false); }} className="h-8 font-mono text-xs" spellCheck={false} />
          )}
          {f.hint && <span className="block text-[11px] leading-relaxed text-muted-foreground">{f.hint}</span>}
        </label>
      ))}
      <div className="flex items-center gap-2">
        <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty || busy} onClick={async () => { setBusy(true); const err = await actions.setSource(id, values); setError(err); setSaved(!err); setBusy(false); }}>Save</Button>
        <span className={cn('text-[11px]', error ? 'text-destructive' : 'text-muted-foreground')}>{error ?? (saved ? 'Saved' : dirty ? 'Unsaved changes' : '')}</span>
      </div>
    </div>
  );
}

function XAppForm({ fromEnv }: { fromEnv: boolean }) {
  const [v, setV] = useState({ clientId: '', clientSecret: '', bearerToken: '' });
  const [acId, setAcId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = v.clientId.trim() && v.clientSecret.trim() && v.bearerToken.trim();
  return (
    <div className="mb-2 space-y-3 rounded-lg border border-[var(--amber-7)] bg-[var(--amber-2)] px-3 py-3 text-xs">
      {fromEnv && (
        <div className="flex items-center gap-2 border-b border-[var(--amber-7)] pb-3">
          <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); setError(await actions.saveXApp({})); setBusy(false); }}>
            {busy ? 'Saving…' : 'Use the app from .env'}
          </Button>
          <span className="text-[11px] text-muted-foreground">Credentials are already on this machine.</span>
        </div>
      )}
      <p className="leading-relaxed">
        X has no managed app, so it needs your own developer app (the free tier works). At <a className="underline underline-offset-2" href="https://developer.x.com" target="_blank" rel="noreferrer">developer.x.com</a> → your app → Keys and tokens. Add <code className="font-mono text-[11px]">https://backend.composio.dev/api/v1/auth-apps/add</code> as a callback URL in the app's user authentication settings.
      </p>
      {([['clientId', 'OAuth 2.0 Client ID', false], ['clientSecret', 'OAuth 2.0 Client Secret', true], ['bearerToken', 'App Bearer Token', true]] as const).map(([k, label, secret]) => (
        <label key={k} className="block space-y-1">
          <span className="font-medium">{label}</span>
          <Input type={secret ? 'password' : 'text'} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="h-8 bg-card font-mono text-xs" spellCheck={false} autoComplete="off" />
        </label>
      ))}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!ready || busy} onClick={async () => { setBusy(true); setError(await actions.saveXApp(v)); setBusy(false); }}>{busy ? 'Saving…' : 'Save X app'}</Button>
        {error && <span className="text-[11px] text-destructive">{error}</span>}
      </div>
      <details className="border-t border-[var(--amber-7)] pt-2">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">Already made one in the Composio dashboard?</summary>
        <div className="mt-2 flex items-center gap-2">
          <Input value={acId} onChange={(e) => setAcId(e.target.value)} placeholder="ac_…" className="h-8 bg-card font-mono text-xs" spellCheck={false} />
          <Button size="sm" variant="outline" disabled={!acId.trim() || busy} onClick={async () => { setBusy(true); setError(await actions.saveXApp({ authConfigId: acId.trim() })); setBusy(false); }}>Use it</Button>
        </div>
      </details>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2"><h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>{children}</section>;
}
