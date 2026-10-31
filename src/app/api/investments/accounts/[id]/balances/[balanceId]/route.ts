import { NextRequest, NextResponse } from 'next/server';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse } from '../../../../_lib/http';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; balanceId: string }> }
) {
  const { id, balanceId } = await params;
  try {
    const { enteredBalances } = await getInvestmentServices();
    await enteredBalances.delete(id, balanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to delete balance');
  }
}
