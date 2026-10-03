# GreenWise

A personal finance app built for decisions, not just tracking. GreenWise works out what you can safely spend after bills, repayments and savings, answers "Can I afford it?" separately from "Should I buy it?", and keeps you accountable to the commitments you make.

## Features

- **Safe to spend:** your balance minus everything already committed before payday, with the working shown
- **Purchase decisions:** affordability, financial impact and priority, with the reasons behind the verdict
- **Plan:** budgets, savings goals, regular payments, income scenarios (slow, normal and good months) and a priority ranking
- **Debts:** payoff dates, repayment burden, and a comparison of repayment strategies
- **Commitments and alerts:** warnings before a limit or goal slips, not after
- **Insights:** spending patterns that lead to a decision

## Stack

React + TypeScript (Vite) and Supabase (Postgres, Auth, row-level security). Every table is locked to the signed-in user.

## Run locally

```bash
npm install
npm run dev
```

The database schema is in `supabase/`. Run `schema.sql`, then `002_onboarding.sql`, in the Supabase SQL Editor.

Transactions carry a `source` field (`manual` or `bank`), so Open Banking can be added later without changing the financial engine.
