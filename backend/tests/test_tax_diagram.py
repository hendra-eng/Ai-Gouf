"""
tests/test_tax_diagram.py
Uji dasar untuk modules/tax_diagram.py.
"""
from modules.schemas import DiagramRequest
from modules.tax_diagram import generate_diagram, available_topics


def test_known_topic_returns_specific_template():
    response = generate_diagram(DiagramRequest(topic="keberatan"))

    assert "SKP diterbitkan" in response.mermaid_code
    assert "flowchart TD" in response.mermaid_code
    assert response.topic == "keberatan"


def test_topic_matching_is_case_insensitive():
    response = generate_diagram(DiagramRequest(topic="  KEBERATAN  "))
    assert "SKP diterbitkan" in response.mermaid_code


def test_unknown_topic_falls_back_to_default_template():
    response = generate_diagram(DiagramRequest(topic="topik acak yang belum ada"))
    assert "Identifikasi isu pajak" in response.mermaid_code


def test_question_context_appended_to_explanation():
    response = generate_diagram(
        DiagramRequest(topic="restitusi ppn", question="Berapa lama prosesnya?")
    )
    assert "Berapa lama prosesnya?" in response.explanation


def test_available_topics_lists_known_templates():
    topics = available_topics()
    assert "keberatan" in topics
    assert "restitusi ppn" in topics