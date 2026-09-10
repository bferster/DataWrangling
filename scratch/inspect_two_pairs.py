import pandas as pd
mentions = pd.read_csv('COMMON/mentions.csv', encoding='utf-8-sig', low_memory=False).set_index('mention_id').to_dict(orient='index')

for s, t in [('AUG-CN-1870-12372', 'AUG-CN-1880-16697'), ('AUG-CN-1870-1552', 'AUG-CN-1880-3036')]:
    ms = mentions.get(s, {})
    mt = mentions.get(t, {})
    print(f"Pair {s} -> {t}:")
    print(f"  1870: Name={ms.get('norm_first_name')} {ms.get('nysiis_last_name')}, Birth={ms.get('birth_year')}, Gender={ms.get('gender')}, Race={ms.get('norm_race')}, Family={ms.get('family_id')}")
    print(f"  1880: Name={mt.get('norm_first_name')} {mt.get('nysiis_last_name')}, Birth={mt.get('birth_year')}, Gender={mt.get('gender')}, Race={mt.get('norm_race')}, Family={mt.get('family_id')}")
