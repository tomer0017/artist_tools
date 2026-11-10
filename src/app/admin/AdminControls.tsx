'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PLAN_NAMES, type PlanId } from '@/lib/plans';
import { changePlan, changeRole, type ActionResult } from './actions';

// The two things an admin can change on an account, each behind a
// confirmation. The server re-checks everything (see ./actions.ts); these
// controls only ask and report.

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p role="status" className={`mt-2 text-xs ${result.ok ? 'text-primary' : 'text-destructive'}`}>
      {result.message}
    </p>
  );
}

export function PlanControl({ userId, plan, name }: { userId: string; plan: PlanId; name: string }) {
  const [target, setTarget] = useState<PlanId | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const confirm = () => {
    const next = target;
    if (!next) return;
    startTransition(async () => {
      setResult(await changePlan({ userId, plan: next }));
      router.refresh();
    });
  };

  return (
    <div>
      <div role="group" aria-label="Assigned plan" className="flex gap-1 rounded-lg bg-secondary/60 p-1">
        {(['free', 'pro'] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={plan === p}
            disabled={pending}
            onClick={() => {
              setResult(null);
              if (p !== plan) setTarget(p);
            }}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
              plan === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {PLAN_NAMES[p]}
          </button>
        ))}
      </div>
      <Result result={result} />
      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change {name}&rsquo;s plan to {target ? PLAN_NAMES[target] : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              {target === 'pro'
                ? 'For testing: no payment is taken. Pro features apply from their next request.'
                : 'They lose Pro features from their next request.'}{' '}
              The change is recorded in the activity log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>Change plan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function RoleControl({ userId, role, name, isSelf }: { userId: string; role: 'user' | 'admin'; name: string; isSelf: boolean }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const next = role === 'admin' ? 'user' : 'admin';

  if (isSelf) {
    return (
      <p className="text-sm text-muted-foreground">
        This is your own account. You cannot remove your own admin access here; another admin, or the server command line, can.
      </p>
    );
  }

  const confirm = () =>
    startTransition(async () => {
      setResult(await changeRole({ userId, role: next }));
      router.refresh();
    });

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className={`h-10 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-60 ${
          next === 'admin'
            ? 'border border-border bg-secondary/60 text-foreground hover:bg-secondary'
            : 'border border-destructive/50 text-destructive hover:bg-destructive/10'
        }`}
      >
        {next === 'admin' ? 'Make admin' : 'Remove admin access'}
      </button>
      <Result result={result} />
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{next === 'admin' ? `Make ${name} an admin?` : `Remove ${name}'s admin access?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {next === 'admin'
                ? 'Admins can see every account and change plans and roles. Only do this for someone you trust.'
                : 'They lose access to the admin dashboard on their next request.'}{' '}
              The change is recorded in the activity log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>{next === 'admin' ? 'Make admin' : 'Remove access'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
