# Getting one real reaction (for the Usefulness criterion)

A single quote from someone who runs a Hyperlane route ("we'd run this on our route", or even "we wouldn't, because…") is worth more to judges than another feature. These are ready to post. Post them from your own account; don't promise anything the README doesn't show.

## Where to post

- **Hyperlane Discord**: the builders or warp-routes channel. Warp-route deployers are exactly the audience.
- **Reactive Network Discord**: the buildathon or showcase channel. Ask for feedback from the team, who are also the judges.
- **X**: reply to or quote a Hyperlane or Reactive post, tagging both.

## Message for Hyperlane builders (route deployers)

> Hey all, I built **Noether** for the Reactive Omni buildathon: an independent checker for Hyperlane Warp Routes.
>
> It reads both ends of a route from Reactive Network and checks one thing: every delivery on one chain matches a dispatch on the other. It doesn't trust the route's ISM or relayer, it audits the results. If a key gets stolen and someone mints tokens nobody locked, it freezes the route on every chain in one reaction.
>
> Two ways to use it:
> - **Monitor** (zero integration): one transaction to start watching any route; it raises an on-chain alert on an unbacked mint or release.
> - **Enforce**: `script/protect.sh` wraps your route's *current* ISM, so verification is unchanged, and adds the freeze. It took about 2 minutes on a stock route.
>
> Live dashboard: https://noether-ashy.vercel.app · Code: https://github.com/s70239176-ctrl/noether
>
> Honest question for anyone running a route: **would you run this on yours?** If not, what would stop you: trust in Reactive, the freeze being too blunt, cost, something else? Even a one-line answer helps.

## Message for the Reactive team

> Hi! Submitting **Noether** to the Omni buildathon (Every Second Counts, plus Reactive Meets AI).
>
> One reactive contract enforces a conservation law across a live Hyperlane route on Base Sepolia and Unichain Sepolia. A forged mint froze both chains in 1–2 s and paid cover in 3 s, and the neural scorer runs inside `react()`. There's also a Monitor mode that audits any route from public events with zero integration.
>
> Dashboard: https://noether-ashy.vercel.app · Evidence with every tx: https://github.com/s70239176-ctrl/noether/blob/main/docs/LIVE_EVIDENCE.md
>
> Two things I'd love feedback on: (1) we saw a ~25 min callback-delivery stall on Lasna on 2026-11-19; is that known? (2) Is the dynamic Cron1 subscription (subscribed only while a suspect is open) the pattern you'd recommend?

## If someone answers

Ask before quoting them, then add the quote to the README's "Who this is for" section with their name or handle, the date, and a link to the message if it's public. Negative answers are useful too: a stated limitation plus "here's how we'd address it" reads as credibility, not weakness.
