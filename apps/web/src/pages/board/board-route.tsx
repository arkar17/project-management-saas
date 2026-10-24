import { useSearchParams } from 'react-router-dom';
import { BoardPage } from './board-page';

/** `?scope=active` opens the board on the active sprint (linked from the sprint page). */
export function BoardRoute() {
  const scope = useSearchParams()[0].get('scope') === 'active' ? 'active' : 'all';
  return <BoardPage key={scope} initialScope={scope} />;
}
