-- One-way finance requests: the buyer asks for an amount; each partner bank approves (with amount and terms) or declines.
alter table finance_requests add column amount numeric(18,2) check (amount > 0);
alter table finance_requests add column currency char(3);
alter table finance_responses add column approved_amount numeric(18,2) check (approved_amount > 0);
alter table finance_responses drop constraint finance_responses_decision_check;
alter table finance_responses add constraint finance_responses_decision_check check (decision in ('approved','interested','more_information','declined'));
