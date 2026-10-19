'use client';
import dynamic from 'next/dynamic';

const Skeleton = () => <div className="skeleton h-64 w-full rounded-md" aria-hidden />;
export const TrendChart = dynamic(() => import('./charts-impl').then((m) => m.TrendChart), {
  ssr: false,
  loading: Skeleton,
});
export const SpendLeadsChart = dynamic(() => import('./charts-impl').then((m) => m.SpendLeadsChart), {
  ssr: false,
  loading: Skeleton,
});
export const HBar = dynamic(() => import('./charts-impl').then((m) => m.HBar), {
  ssr: false,
  loading: () => <div className="skeleton h-40 w-full rounded-md" aria-hidden />,
});
