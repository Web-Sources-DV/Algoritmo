"""Pruebas de interacción contra la aplicación real, sin navegador externo."""
import unittest
from pathlib import Path
from streamlit.testing.v1 import AppTest

APP = str(Path(__file__).resolve().parents[1]/'app.py')

class WebTests(unittest.TestCase):
    def test_demo_end_to_end(self):
        app = AppTest.from_file(APP,default_timeout=30).run()
        self.assertFalse(app.exception)
        self.assertEqual(len(app.metric),0)
        app.button[0].click().run()
        self.assertFalse(app.exception)
        result = app.session_state['result']
        self.assertTrue(result['summary']['synthetic'])
        self.assertEqual(result['rows'],2400)
        self.assertEqual(len(app.metric),4)
        self.assertEqual(len(app.tabs),4)
        self.assertGreater(len(result['bets']),0)
        self.assertEqual(len(app.get('download_button')),4)
        # Un intento inválido borra resultados anteriores y explica el problema.
        app.selectbox[0].select('Subir CSV históricos').run()
        app.button[0].click().run()
        self.assertFalse(app.exception)
        self.assertEqual(len(app.metric),0)
        self.assertTrue(any('Selecciona al menos un CSV' in e.value for e in app.error))

    def test_risk_validation(self):
        app = AppTest.from_file(APP,default_timeout=30).run()
        app.slider[3].set_value(.1).run()  # límite diario menor que tope individual
        app.button[0].click().run()
        self.assertFalse(app.exception)
        self.assertTrue(any('máximo por apuesta' in e.value for e in app.error))
        self.assertEqual(len(app.metric),0)

if __name__ == '__main__':
    unittest.main()
