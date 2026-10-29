from db import SessionLocal, DictionaryRule
db = SessionLocal()
rules = db.query(DictionaryRule).all()
if rules:
    print('\n--- DOCTOR DICTIONARY ---')
    for r in rules:
        print(f"Misheard: {r.misheard_word} -> Correct: {r.correct_word}")
    print('-------------------------\n')
else:
    print('\nDictionary is currently empty.\n')
db.close()
