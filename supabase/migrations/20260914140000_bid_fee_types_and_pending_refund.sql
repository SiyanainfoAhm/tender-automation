begin;

-- TF-48: courier + legal fee types
-- TF-54: pending_refund status for refundable fee lifecycle

alter table public.agenttender_bid_fees
  drop constraint if exists agenttender_bid_fees_fee_type_check;

alter table public.agenttender_bid_fees
  add constraint agenttender_bid_fees_fee_type_check
  check (
    fee_type in (
      'tender_fee',
      'emd',
      'processing',
      'pbg',
      'courier',
      'legal',
      'other'
    )
  );

alter table public.agenttender_bid_fees
  drop constraint if exists agenttender_bid_fees_status_check;

alter table public.agenttender_bid_fees
  add constraint agenttender_bid_fees_status_check
  check (
    status in (
      'pending',
      'submitted',
      'paid',
      'pending_refund',
      'refunded',
      'released',
      'expired'
    )
  );

commit;
