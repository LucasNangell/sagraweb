from services.os_search_export_service import OS_LIST_EXPORT_COLUMNS


def test_export_columns_entrada_after_ano():
    keys = [key for _, key in OS_LIST_EXPORT_COLUMNS]
    assert keys.index("data_entrada") == keys.index("ano") + 1
    labels = [label for label, _ in OS_LIST_EXPORT_COLUMNS]
    assert labels[keys.index("data_entrada")] == "Entrada"
