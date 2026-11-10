import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { SplitwiseExportError } from '@/lib/splitwise/export';
import {
  SplitwiseConflictError,
  SplitwiseNotFoundError,
  SplitwiseUndoError,
} from '@/lib/splitwise/importer';

/** Runs a Splitwise route body and maps the importer's errors to responses, in one place. */
export async function respond(body: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return NextResponse.json(await body());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const status =
      error instanceof SplitwiseExportError
        ? 400
        : error instanceof SplitwiseNotFoundError
          ? 404
          : error instanceof SplitwiseUndoError || error instanceof SplitwiseConflictError
            ? 409
            : null;
    if (status && error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error('Splitwise import failed:', error);
    return NextResponse.json(
      { error: 'The import failed and nothing was saved. Try again.' },
      { status: 500 }
    );
  }
}
