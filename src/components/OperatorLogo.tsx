export default function OperatorLogo({ provider, className = '' }: { provider: string; className?: string }) {
  const operator = provider.startsWith('cta') ? 'cta' : provider === 'metra' ? 'metra' : 'divvy';
  return <img className={`operator-logo operator-${operator} ${className}`} src={`/operators/${operator}.${operator === 'cta' ? 'png' : 'svg'}`} alt={operator === 'cta' ? 'CTA' : operator === 'metra' ? 'Metra' : 'Divvy'} />;
}
