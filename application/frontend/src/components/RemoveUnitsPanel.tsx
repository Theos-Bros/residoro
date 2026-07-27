import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { removeUnits, type ProjectUnitType } from '@/lib/projectsApi';
import { parseUnitNumbers } from '@/components/UnitTypesSection';
import { ConfirmRemoveUnitsModal } from '@/components/ConfirmRemoveUnitsModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  session: Session;
  projectId: string;
  developerName: string;
  projectName: string;
  unitType: ProjectUnitType;
  onRemoved: (removedUnitNumbers: string[]) => void;
  onClose: () => void;
};

// tb-properties-project-rollup-001 follow-up: a floating panel anchored to
// the bottom-left corner (like a chat widget), not a centered modal -- the
// user asked for this shape specifically, distinct from
// ConfirmRemoveUnitsModal's centered confirm step. The count field is a
// lightweight typo guard: it must match the parsed unit-number list length
// before "Review removal" is enabled, catching a mis-pasted list before it
// ever reaches the destructive confirm step.
export function RemoveUnitsPanel({ session, projectId, developerName, projectName, unitType, onRemoved, onClose }: Props) {
  const [countInput, setCountInput] = useState('');
  const [unitNumbersInput, setUnitNumbersInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const parsedUnitNumbers = parseUnitNumbers(unitNumbersInput);

  function handleReview() {
    setValidationError(null);
    const expectedCount = Number(countInput);

    if (parsedUnitNumbers.length === 0) {
      setValidationError('Enter at least one unit/lot number to remove.');
      return;
    }
    if (!Number.isInteger(expectedCount) || expectedCount < 1) {
      setValidationError('Enter how many units you expect to remove.');
      return;
    }
    if (expectedCount !== parsedUnitNumbers.length) {
      setValidationError(
        `You entered ${parsedUnitNumbers.length} unit number${parsedUnitNumbers.length === 1 ? '' : 's'} but expected ${expectedCount} -- check for a typo before continuing.`,
      );
      return;
    }

    setConfirmError(null);
    setConfirming(true);
  }

  async function handleConfirm() {
    setConfirmError(null);
    setBusy(true);
    try {
      const { unit_numbers } = await removeUnits(session.access_token, projectId, unitType.id, parsedUnitNumbers);
      onRemoved(unit_numbers);
      onClose();
    } catch (err) {
      setConfirmError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed bottom-4 left-4 z-40 w-80">
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Remove units — {unitType.name}</span>
              <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
                ✕
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="remove_units_count">Number of units to remove</Label>
              <Input
                id="remove_units_count"
                type="number"
                min="1"
                step="1"
                value={countInput}
                onChange={(e) => setCountInput(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="remove_units_numbers">Exact unit/lot numbers</Label>
              <Input
                id="remove_units_numbers"
                type="text"
                value={unitNumbersInput}
                onChange={(e) => setUnitNumbersInput(e.target.value)}
                placeholder="e.g. 1F, 2B"
              />
            </div>
            {validationError && (
              <p role="alert" className="text-xs text-destructive">
                {validationError}
              </p>
            )}
            <Button size="sm" variant="outline" onClick={handleReview}>
              Review removal
            </Button>
          </CardContent>
        </Card>
      </div>

      {confirming && (
        <ConfirmRemoveUnitsModal
          developerName={developerName}
          projectName={projectName}
          unitTypeName={unitType.name}
          unitNumbers={parsedUnitNumbers}
          busy={busy}
          error={confirmError}
          onConfirm={handleConfirm}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
