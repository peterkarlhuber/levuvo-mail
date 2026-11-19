# Personal data breach response (Art. 33/34 GDPR)

For Levuvo as controller (update logs, crash reports, support data) and as guidance for
organisations using Levuvo Mail. Combined with CRA incident reporting:
[../cra/INCIDENT-REPORTING.md](../cra/INCIDENT-REPORTING.md). **Not legal advice.**

1. **Detect and record** (time of awareness, what happened, which data, how many people).
2. **Contain** (revoke tokens, rotate keys, pull a release, block an account).
3. **Assess risk** to data subjects (confidentiality, integrity, availability; special categories?).
4. **Notify the Austrian Data Protection Authority within 72 hours** unless the breach is unlikely to
   result in a risk (Art. 33(1)); use the DSB online form (dsb.gv.at). Late notifications need reasons.
5. **Inform data subjects without undue delay** when the risk is high (Art. 34), in clear language,
   with the likely consequences and measures.
6. **Document every breach**, also those not notified (Art. 33(5)).
7. **Processor duties:** if Levuvo learns of a breach in a component that affects customers' data
   (for example a vulnerability that leaked mail), inform customers immediately so they can meet
   their own 72-hour deadline; this is part of the CRA user information duty (Art. 14(8)).

Examples relevant for Levuvo Mail: a vulnerability that lets a mail exfiltrate local data; a
compromised update; a crash report service leak; a lost device without disk encryption (customer side).
