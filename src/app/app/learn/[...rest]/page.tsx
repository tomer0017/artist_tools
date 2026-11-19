import { redirect } from 'next/navigation';

// Any other address in Learn leads to the Learn home (as unknown tool
// addresses lead Home); the Learn home's own page decides who sees Learn.
export default function UnknownLearnPage() {
  redirect('/app/learn');
}
