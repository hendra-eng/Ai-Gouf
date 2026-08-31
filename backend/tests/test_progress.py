"""
tests/test_progress.py
=======================
Unit test untuk progress tracking
"""

import pytest
import time
from modules.progress import (
    ProgressTracker,
    batch_process_with_progress,
    ProgressCallback,
)


class TestProgressTracker:
    """Test ProgressTracker class"""
    
    def test_tracker_initialization(self):
        """Test inisialisasi tracker"""
        tracker = ProgressTracker()
        assert tracker.total == 0
        assert tracker.current == 0
        assert tracker.status == "idle"
    
    def test_tracker_start(self):
        """Test start tracker"""
        tracker = ProgressTracker()
        tracker.start(total=10, description="Processing")
        
        assert tracker.total == 10
        assert tracker.status == "running"
        assert tracker.start_time is not None
    
    def test_tracker_update(self):
        """Test update progress"""
        tracker = ProgressTracker()
        tracker.start(total=10)
        
        tracker.update(current=3, current_item="Item 3")
        assert tracker.current == 3
        assert tracker.percent == 30.0
    
    def test_tracker_complete(self):
        """Test complete tracker"""
        tracker = ProgressTracker()
        tracker.start(total=10)
        tracker.current = 10
        
        tracker.complete("Done")
        assert tracker.status == "completed"
        assert tracker.end_time is not None
        assert tracker.elapsed_time is not None
    
    def test_tracker_fail(self):
        """Test fail tracker"""
        tracker = ProgressTracker()
        tracker.start(total=10)
        
        tracker.fail("Something went wrong")
        assert tracker.status == "failed"
        assert len(tracker.errors) > 0
    
    def test_tracker_add_error(self):
        """Test add error"""
        tracker = ProgressTracker()
        tracker.start(total=10)
        
        tracker.add_error("Test error", {"detail": "test"})
        assert len(tracker.errors) == 1
        assert tracker.errors[0]["error"] == "Test error"
    
    def test_tracker_to_dict(self):
        """Test konversi ke dict"""
        tracker = ProgressTracker()
        tracker.start(total=5)
        tracker.update(current=2)
        
        data = tracker.to_dict()
        assert data["total"] == 5
        assert data["current"] == 2
        assert data["percent"] == 40.0
        assert data["status"] == "running"


class TestBatchProcess:
    """Test batch processing"""
    
    def test_batch_process_simple(self):
        """Test batch processing sederhana"""
        items = [1, 2, 3, 4, 5]
        
        def process_func(item):
            return item * 2
        
        result = batch_process_with_progress(
            items=items,
            process_func=process_func,
            description="Test batch"
        )
        
        assert result["success_count"] == 5
        assert result["error_count"] == 0
        assert len(result["results"]) == 5
        assert result["results"] == [2, 4, 6, 8, 10]
    
    def test_batch_process_with_error(self):
        """Test batch processing dengan error"""
        items = [1, 2, 0, 4, 5]
        
        def process_func(item):
            if item == 0:
                raise ValueError("Zero not allowed")
            return item * 2
        
        result = batch_process_with_progress(
            items=items,
            process_func=process_func,
            description="Test batch with errors"
        )
        
        assert result["success_count"] == 4
        assert result["error_count"] == 1
        assert len(result["errors"]) == 1
    
    def test_batch_process_with_callback(self):
        """Test batch processing dengan callback"""
        items = [1, 2, 3]
        callback_log = []
        
        def callback(current, total, item):
            callback_log.append((current, total, item))
        
        def process_func(item):
            return item
        
        result = batch_process_with_progress(
            items=items,
            process_func=process_func,
            callback=callback
        )
        
        assert len(callback_log) == 3
        assert callback_log[0][0] == 1
        assert callback_log[2][0] == 3


class TestProgressCallback:
    """Test ProgressCallback class"""
    
    def test_callback_initialization(self):
        """Test inisialisasi callback"""
        callback = ProgressCallback(total_steps=5, description="Processing")
        assert callback.total == 5
        assert callback.current == 0
    
    def test_callback_update(self):
        """Test update callback"""
        callback = ProgressCallback(total_steps=5)
        
        callback.update(step=2, message="Step 2")
        assert callback.current == 2
        assert callback.description == "Step 2"
    
    def test_callback_set_message(self):
        """Test set step message"""
        callback = ProgressCallback(total_steps=5)
        callback.set_step_message(0, "Starting")
        callback.set_step_message(2, "Middle")
        
        callback.update(step=2)
        # Description seharusnya update ketika step sesuai
        assert callback.description == "Middle"
    
    def test_callback_get_progress(self):
        """Test get progress"""
        callback = ProgressCallback(total_steps=5)
        callback.update(step=2)
        
        progress = callback.get_progress()
        assert progress["current"] == 2
        assert progress["total"] == 5
        assert progress["percent"] == 40.0