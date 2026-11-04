import type { RoutingStrategy } from '@/types/visualConfig';

export function shouldOfferSoonestReset(
  currentStrategy: RoutingStrategy,
  supported: boolean
): boolean {
  return supported || currentStrategy === 'soonest-reset';
}
