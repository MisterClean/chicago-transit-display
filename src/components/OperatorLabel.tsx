export default function OperatorLabel({ provider, className = '' }: { provider: string; className?: string }) {
  const names: Record<string, string> = { metra: 'Metra', divvy: 'Divvy', lime: 'Lime', spin: 'Spin' };
  const label = provider.startsWith('cta') ? 'CTA' : names[provider] ?? provider;
  return <span className={`operator-label ${className}`}>{label}</span>;
}
