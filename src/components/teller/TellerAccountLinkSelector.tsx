'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ds } from '@/lib/design-system';

type TellerAccount = {
  id: string;
  name: string;
  type: string;
  subtype: string;
  last_four: string;
  status: string;
};

type TellerEnrollment = {
  id: string;
  institutionName: string;
  availableAccounts?: TellerAccount[];
};

interface TellerAccountLinkSelectorProps {
  accountId: string;
  accountName: string;
  onSuccess: () => void;
}

export function TellerAccountLinkSelector({
  accountId,
  accountName,
  onSuccess,
}: TellerAccountLinkSelectorProps) {
  const [enrollments, setEnrollments] = useState<TellerEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');

  useEffect(() => {
    fetchEnrollments();
  }, []);

  const fetchEnrollments = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/teller/enrollment');
      const data = await response.json();

      if (data.error) {
        console.error('Error fetching enrollments:', data.error);
        return;
      }

      setEnrollments(data.enrollments || []);
    } catch (error) {
      console.error('Exception fetching enrollments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLink = async () => {
    if (!selectedEnrollmentId || !selectedAccountId) {
      alert('Please select an account');
      return;
    }

    setLinking(true);

    try {
      // Find the selected account details
      const enrollment = enrollments.find((e) => e.id === selectedEnrollmentId);
      const account = enrollment?.availableAccounts?.find((a) => a.id === selectedAccountId);

      if (!account) {
        alert('Account not found');
        return;
      }

      const response = await fetch('/api/teller/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          tellerEnrollmentId: selectedEnrollmentId,
          tellerAccountId: account.id,
          tellerAccountName: account.name,
          tellerAccountType: account.type,
          tellerAccountSubtype: account.subtype,
          tellerAccountLastFour: account.last_four,
        }),
      });

      const data = await response.json();

      if (data.error) {
        alert(`Error: ${data.error}`);
        return;
      }

      onSuccess();
    } catch (error) {
      console.error('Exception linking account:', error);
      alert('Failed to link account');
    } finally {
      setLinking(false);
    }
  };

  // Get all available accounts across all enrollments
  const availableAccounts = enrollments.flatMap((enrollment) =>
    (enrollment.availableAccounts || []).map((account) => ({
      ...account,
      enrollmentId: enrollment.id,
      institutionName: enrollment.institutionName,
    }))
  );

  if (loading) {
    return (
      <div className={`text-sm ${ds.text.muted}`}>
        Loading available accounts...
      </div>
    );
  }

  if (enrollments.length === 0) {
    return (
      <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
        <p className={`text-sm ${ds.text.secondary} mb-2`}>
          No institutions connected yet.
        </p>
        <p className={`text-sm ${ds.text.muted}`}>
          Connect to a bank first in the "Connected Institutions" section above.
        </p>
      </div>
    );
  }

  if (availableAccounts.length === 0) {
    return (
      <div className={`${ds.bg.secondary} rounded-lg p-4 border ${ds.border.default}`}>
        <p className={`text-sm ${ds.text.secondary}`}>
          No bank accounts available from connected institutions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className={`text-sm ${ds.text.secondary}`}>
        Link <span className="font-semibold">{accountName}</span> to a bank account:
      </p>

      <Select
        value={selectedAccountId}
        onChange={(e) => {
          const accountId = e.target.value;
          setSelectedAccountId(accountId);
          // Find which enrollment this account belongs to
          const account = availableAccounts.find((a) => a.id === accountId);
          if (account) {
            setSelectedEnrollmentId(account.enrollmentId);
          }
        }}
        className="w-full"
      >
        <option value="">Select a bank account...</option>
        {enrollments.map((enrollment) => (
          <optgroup key={enrollment.id} label={enrollment.institutionName}>
            {(enrollment.availableAccounts || []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} (••••{account.last_four}) - {account.subtype}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>

      <Button
        onClick={handleLink}
        disabled={!selectedAccountId || linking}
        className="w-full bg-blue-600 hover:bg-blue-700"
      >
        {linking ? 'Linking...' : 'Link Account'}
      </Button>
    </div>
  );
}
