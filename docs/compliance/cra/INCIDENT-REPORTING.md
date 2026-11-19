# Reporting actively exploited vulnerabilities and severe incidents

CRA Art. 14, applicable from **11 September 2026** to every product made available on the market,
including products placed on the market before 11 December 2027 (Art. 69(3)). Also covers GDPR
Art. 33/34 where personal data is affected ([../gdpr/BREACH-RESPONSE.md](../gdpr/BREACH-RESPONSE.md)).
**Not legal advice.**

> Today Levuvo Mail is used internally only, so Art. 14 does not apply yet. Keep this process ready
> and practise it once a year; it applies from the first day Levuvo Mail is made available on the market.

## 1. Where to report

All notifications go through the **single reporting platform** run by ENISA (Art. 16) to the CSIRT
designated as coordinator of the Member State of the main establishment: for Austria the national
CSIRT [check the designation; CERT.at is the national CSIRT]. Bookmark the platform URL here once
ENISA publishes it: [URL].

## 2. Actively exploited vulnerability (Art. 14(1)–(2))

| Deadline (from becoming aware) | Report | Content |
| --- | --- | --- |
| **24 hours** | Early warning | That an actively exploited vulnerability exists; where known, the Member States where the product is made available |
| **72 hours** | Vulnerability notification | Product, general nature of the exploit and the vulnerability, corrective or mitigating measures taken, measures users can take, how sensitive the information is |
| **14 days after a corrective measure is available** | Final report | Description incl. severity and impact, information on the malicious actor if available, details of the security update or other measures |

## 3. Severe incident affecting the security of Levuvo Mail (Art. 14(3)–(4))

A severe incident is one that affects the ability of the product to protect data or functions, or
that led or can lead to malicious code being introduced (Art. 14(5)) – for example a compromised
build pipeline, a stolen signing certificate or a manipulated update.

| Deadline | Report | Content |
| --- | --- | --- |
| **24 hours** | Early warning | Whether it was presumably caused by unlawful or malicious acts; Member States concerned |
| **72 hours** | Incident notification | General nature, initial assessment, corrective measures, measures users can take, sensitivity |
| **One month after the notification** | Final report | Detailed description, severity, impact, threat type or root cause, applied and ongoing mitigation |

## 4. Informing users (Art. 14(8))

Without undue delay after becoming aware: inform affected users (and, where appropriate, all users)
about the vulnerability or incident and the mitigation they can apply – via the GitHub Security
Advisory, the release notes, the website and, where the app can still update, the update dialog.

## 5. Checklist when it happens

1. Note the time of awareness. Open a private GitHub advisory; it is the case file.
2. Security owner decides within 4 hours whether the case is reportable.
3. Contain: revoke compromised keys or tokens, pull a manipulated release (mark it as
   pre-release/withdrawn), rotate the signing certificate if needed.
4. Send the 24 h early warning, the 72 h notification and the final report on time; store copies
   in the advisory.
5. Check GDPR: if personal data of users or third parties is affected and Levuvo is the controller
   (update logs, crash reports, support data), notify the Austrian Data Protection Authority within
   72 hours (Art. 33 GDPR). Customers who are controllers of their own mail data need our facts quickly.
6. Fix, release, publish the advisory, inform users.
7. Post-mortem within two weeks; update [RISK-ASSESSMENT.md](RISK-ASSESSMENT.md).

## 6. Voluntary reporting (Art. 15)

Vulnerabilities that are not actively exploited, cyber threats and near misses may be reported
voluntarily to the CSIRT or ENISA.
