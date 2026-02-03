'use client';

import { Modal } from './ui/modal';
import { ChartRenderer } from './chart-renderer';
import { Button } from './ui/button';
import { ChartSpec } from '@/lib/types';

type Props = {
  spec: ChartSpec | null;
  onClose: () => void;
  onPin: (spec: ChartSpec) => void;
};

export function ChartModal({ spec, onClose, onPin }: Props) {
  if (!spec) return null;

  return (
    <Modal isOpen={!!spec} size="xl" title={spec.title || 'Chart'} onClose={onClose}>
      <div className="h-96">
        <ChartRenderer spec={{ ...spec, title: '' }} />
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          variant="outline"
          onClick={() => {
            onPin(spec);
            onClose();
          }}
        >
          Pin to Dashboard
        </Button>
      </div>
    </Modal>
  );
}
