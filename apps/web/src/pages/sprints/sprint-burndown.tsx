import { BurndownChart, RangeNote } from '../../components/charts';
import { ErrorState, Loading } from '../../components/page-state';
import { Card } from '../../components/ui/card';
import { useBurndown } from '../../lib/reports';

/** FR-RPT-003 burndown with the numbers as a table and unestimated issues called out. */
export function SprintBurndown({ sid }: { sid: string }) {
  const burndown = useBurndown(sid);
  return (
    <Card title="Burndown">
      {burndown.isPending ? (
        <Loading />
      ) : burndown.isError ? (
        <ErrorState error={burndown.error} />
      ) : burndown.data.days.length === 0 ? (
        <p className="text-sm text-muted">The burndown starts when the sprint starts.</p>
      ) : (
        <div className="space-y-4">
          <RangeNote range={burndown.data.range} />
          <BurndownChart data={burndown.data} />
          {burndown.data.unestimated.length > 0 && (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">
                {burndown.data.unestimated.length} unestimated issue
                {burndown.data.unestimated.length === 1 ? '' : 's'} (counted as 0 points)
              </p>
              <ul className="mt-1 list-inside list-disc">
                {burndown.data.unestimated.map((i) => (
                  <li key={i.id}>
                    {i.key} · {i.title}
                    {!i.committed && ' (added after start)'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-primary">
              Daily values
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Day</th>
                    <th className="py-1 pr-3 font-medium">Remaining</th>
                    <th className="py-1 pr-3 font-medium">Ideal</th>
                    <th className="py-1 font-medium">Scope added</th>
                  </tr>
                </thead>
                <tbody>
                  {burndown.data.days.map((d) => (
                    <tr key={d.date} className="border-t border-border">
                      <td className="py-1 pr-3">{d.date}</td>
                      <td className="py-1 pr-3">{d.remainingCommittedPoints ?? '—'}</td>
                      <td className="py-1 pr-3">{Math.round(d.idealPoints * 10) / 10}</td>
                      <td className="py-1">{d.scopeAddedPoints ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </Card>
  );
}
