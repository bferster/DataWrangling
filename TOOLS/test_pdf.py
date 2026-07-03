import PyPDF2
import sys

def extract_text(pdf_path):
    try:
        with open(pdf_path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            text = ''
            for i, page in enumerate(reader.pages[:2]): # Read first 2 pages
                text += page.extract_text()
            print("Successfully extracted text:")
            print(text[:1000])
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    extract_text('AugustaFNR.pdf')
