// Floating prompt bar over the canvas. Enter sends, Shift+Enter breaks a line.
import { useState } from 'react';
import { ArrowUp, AtSign, ClipboardList, Hash, Mail, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { actions } from '@/store';

type Ch = 'email' | 'form' | 'slack' | 'discord' | 'x';
const CHANNELS: { v: Ch; label: string; Icon: typeof Mail }[] = [
  { v: 'email', label: 'Email', Icon: Mail },
  { v: 'form', label: 'Form lead', Icon: ClipboardList },
  { v: 'slack', label: 'Slack', Icon: Hash },
  { v: 'discord', label: 'Discord', Icon: MessageCircle },
  { v: 'x', label: 'X mention', Icon: AtSign },
];

export function Composer() {
  const [text, setText] = useState('');
  const [channel, setChannel] = useState<Ch>('email');
  const [sending, setSending] = useState(false);
  const send = async () => {
    const t = text.trim(); if (!t || sending) return;
    setSending(true); setText('');
    await actions.simulate(t, channel);
    setSending(false);
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-2xl rounded-2xl border bg-card p-2 shadow-lg ring-1 ring-black/[0.03] dark:ring-white/[0.04]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          rows={1}
          placeholder="Type a message and watch it move through the flow…"
          className="autogrow max-h-40 w-full resize-none bg-transparent px-2.5 pt-1.5 pb-1 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1.5">
          <Select value={channel} onValueChange={(v) => setChannel(v as Ch)}>
            <SelectTrigger size="sm" className="h-7 gap-1.5 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-accent focus-visible:ring-0 data-[size=sm]:h-7 dark:bg-transparent dark:hover:bg-accent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {CHANNELS.map((c) => <SelectItem key={c.v} value={c.v} className="text-xs"><c.Icon className="size-3.5" />{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">Runs Jev and the write agents. Nothing leaves this machine.</span>
          <div className="flex-1" />
          <Kbd className="text-[10px]">↵</Kbd>
          <Button size="icon" className="size-7 rounded-full" disabled={!text.trim() || sending} onClick={() => void send()} aria-label="Run">
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
