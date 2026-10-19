import { redirect } from 'next/navigation';

export default function Deals() {
  redirect('/pipeline?view=list');
}
