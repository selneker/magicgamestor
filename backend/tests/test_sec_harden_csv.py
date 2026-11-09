"""PL-SEC-HARDEN-1 D — export CSV : préfixes dangereux restants."""


class TestCsvNeutralisation:
    def test_tab_and_carriage_return_are_neutralised(self):
        from routers.orders import _csv_cell
        assert _csv_cell("\t=cmd") == "\"'\t=cmd\""
        assert _csv_cell("\r@SUM(A1)") == "\"'\r@SUM(A1)\""

    def test_existing_prefixes_still_neutralised(self):
        from routers.orders import _csv_cell
        for value in ("=1+1", "+1", "-1", "@cmd"):
            assert _csv_cell(value) == "\"'" + value + "\""

    def test_normal_value_is_unchanged(self):
        from routers.orders import _csv_cell
        assert _csv_cell("MGS-ABC123") == '"MGS-ABC123"'
        assert _csv_cell(None) == '""'
